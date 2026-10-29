import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { HarnessError } from "@deepseek-ai/dsh-llm";

//#region plugin metadata
/**
 * Cordis plugin name used by loader diagnostics.
 *
 * @constant {string}
 */
const name = "tool-ast-index";

/**
 * Services required by this plugin. `subprocess` runs the `ast-index` CLI as an
 * ordinary foreground spawn (never `ctx.shell`, never a model-visible
 * background task); `workingDirectory` resolves the calling agent's session
 * current directory, which ast-index treats as its project root.
 *
 * @constant {string[]}
 */
const inject = ["tools", "subprocess", "workingDirectory"];

/**
 * Plugin configuration schema (schemastery). Every cap counts bytes or
 * milliseconds; `bin` is the ast-index executable name or absolute path.
 */
const Config = z.object({
  bin: z.string().default("ast-index"),
  timeoutMs: z.number().default(30000),
  rawOutputMaxBytes: z.number().default(20_000_000),
  stderrMaxBytes: z.number().default(65536),
  graceMs: z.number().default(3000),
});
//#endregion

//#region argv helpers
/** Push a string flag/value pair when the value is present and non-empty. */
function str(a, v, flag) {
  if (v !== undefined && v !== null && v !== "") a.push(flag, String(v));
}

/** Push a numeric flag/value pair when the value is present. */
function num(a, v, flag) {
  if (v !== undefined && v !== null) a.push(flag, String(v));
}

/** Push a bare boolean flag when the value is `true`. */
function bool(a, v, flag) {
  if (v === true) a.push(flag);
}
//#endregion

//#region tool spec table
/**
 * One structural-navigation tool. `parameters` is the dsh JSON-schema-ish
 * argument DSL (type / required / description / enum), `argv` translates the
 * validated arguments into the equivalent `ast-index <subcommand> …` tokens
 * (NOT including the binary, and always in the token-efficient text mode).
 *
 * Tool names and semantics mirror the `crates/ast-index-mcp` server so the two
 * surfaces stay interchangeable.
 */
const TOOLS = [
  {
    name: "explore",
    description: "Call this FIRST for 'how does X work', 'where/what is X' or an area survey: one call returns the relevant symbols ranked, an outline with line ranges of the best types/modules and the source of the best functions (read fresh from disk), their callers/subclasses and tests found by path convention — instead of a grep + read loop. Dependencies' .d.ts and cross-stack matches rank lower.",
    parameters: {
      query: { type: "string", required: true, description: "Natural-language question or a bag of symbol/file names." },
      max_files: { type: "integer", description: "Max source files to include (default 6)." },
      rwr: { type: "boolean", description: "Re-rank by an in-memory call/inheritance graph to surface callers/subclasses; slightly slower." },
    },
    argv(args) {
      const a = ["explore", args.query];
      num(a, args.max_files, "--max-files");
      bool(a, args.rwr, "--rwr");
      return a;
    },
  },
  {
    name: "search",
    description: "Literal search over paths, definitions, imports/usages and file contents, for a known identifier or path fragment (`UserService`, `auth/`). A question goes to `explore` (a multi-word query without literal hits falls back to it). Choosing among several matches? Add `rank`.",
    parameters: {
      query: { type: "string", required: true, description: "Search query. Comma-separated for OR: 'email,mail'." },
      limit: { type: "integer", description: "Max results per category (default 20)." },
      kind: { type: "string", description: "Filter symbols by kind: class, interface, function, method, struct, enum, etc." },
      in_file: { type: "string", description: "Restrict to files whose path contains this substring." },
      module: { type: "string", description: "Restrict to files whose path starts with this prefix." },
      fuzzy: { type: "boolean", description: "Enable typo-tolerant fuzzy matching." },
      rank: { type: "string", enum: ["proven", "hotspots", "risky", "central"], description: "Re-order by Git history and the symbol graph, evidence per result. proven: safest to copy; risky: dangerous to change; hotspots: keeps being changed and fixed; central: what the code leans on. Exact names stay first. Needs `ast-index hotspots --collect` in a shell (not for central) and `graph_build` (not for hotspots); what is missing is reported." },
      exclude_tests: { type: "boolean", description: "With `rank`: leave test files out of the ranked results." },
      with_content: { type: "boolean", description: "Include each matched symbol's bounded source body. Default false." },
    },
    argv(args) {
      const a = ["search", args.query];
      num(a, args.limit, "--limit");
      str(a, args.kind, "--type");
      str(a, args.in_file, "--in-file");
      str(a, args.module, "--module");
      bool(a, args.fuzzy, "--fuzzy");
      if (args.rank) a.push("--rank", args.rank);
      if (args.exclude_tests) {
        if (!args.rank) throw new Error("'exclude_tests' applies to ranked search; add 'rank'");
        a.push("--exclude-tests");
      }
      bool(a, args.with_content, "--with-content");
      return a;
    },
  },
  {
    name: "outline",
    description: "Extract the structural outline (classes, functions, methods with line numbers) of a single source file. ALWAYS call this BEFORE reading a file larger than 500 lines — then read only the targeted slice by offset/limit instead of the whole file.",
    parameters: {
      file: { type: "string", required: true, description: "Path to the source file (relative to project root or absolute)." },
    },
    argv(args) {
      return ["outline", args.file];
    },
  },
  {
    name: "usages",
    description: "Every indexed reference to a symbol name (call, type use, import, …) as file:line + the line's text — for 'who uses X'. Matched by name, not resolved by type: same-named symbols are mixed, and a mention in a comment or string can slip in. For the dependents of one definition use `graph_dependents`.",
    parameters: {
      symbol: { type: "string", required: true, description: "Symbol name (class, function, method)." },
      limit: { type: "integer", description: "Max results (default 50)." },
      in_file: { type: "string", description: "Restrict to files whose path contains this substring." },
      module: { type: "string", description: "Restrict to files whose path starts with this prefix." },
    },
    argv(args) {
      const a = ["usages", args.symbol];
      num(a, args.limit, "--limit");
      str(a, args.in_file, "--in-file");
      str(a, args.module, "--module");
      return a;
    },
  },
  {
    name: "callers",
    description: "Call sites of a function by name: matching lines (`name(`, `.name`, …) as file:line + text — for 'where is X called'. It does not name the calling function; for that, and for callers of callers, use `call_tree`. A text match at query time: same-named methods, comments and strings can appear.",
    parameters: {
      function: { type: "string", required: true, description: "Function or method name." },
      limit: { type: "integer", description: "Max results (default 50)." },
    },
    argv(args) {
      const a = ["callers", args.function];
      num(a, args.limit, "--limit");
      return a;
    },
  },
  {
    name: "implementations",
    description: "Find every class/struct/type that implements (Java/Kotlin/Swift/Scala) or extends (C++, Rust trait, etc.) the given interface, protocol, or abstract class. Use this for 'what implements PaymentProcessing' questions.",
    parameters: {
      parent: { type: "string", required: true, description: "Name of the interface, protocol, trait, or abstract class." },
      with_content: { type: "boolean", description: "Include each implementation's bounded source body. Default false." },
      limit: { type: "integer", description: "Max results (default 50)." },
      in_file: { type: "string", description: "Restrict to files whose path contains this substring." },
      module: { type: "string", description: "Restrict to files whose path starts with this prefix." },
    },
    argv(args) {
      const a = ["implementations", args.parent];
      bool(a, args.with_content, "--with-content");
      num(a, args.limit, "--limit");
      str(a, args.in_file, "--in-file");
      str(a, args.module, "--module");
      return a;
    },
  },
  {
    name: "refs",
    description: "Show cross-references for a symbol in one shot: every definition, every import, every usage. Use this when you want the complete picture in a single response, rather than calling `usages` / `callers` separately. Deduplicated and grouped by kind; usages are matched by name, as in `usages`.",
    parameters: {
      symbol: { type: "string", required: true, description: "Symbol name." },
      limit: { type: "integer", description: "Max results per category (default 50)." },
    },
    argv(args) {
      const a = ["refs", args.symbol];
      num(a, args.limit, "--limit");
      return a;
    },
  },
  {
    name: "symbol",
    description: "Find symbols by exact name or glob pattern, optionally filtered by kind (class/function/method/struct/etc). Sharper than `search` when you know what you're looking for. Use `search` for broad discovery; use this when the name or pattern is specific.",
    parameters: {
      name: { type: "string", description: "Exact symbol name. Use either 'name' or 'pattern', not both." },
      pattern: { type: "string", description: "Glob pattern for symbol name (e.g. '*Service', '*Email*')." },
      kind: { type: "string", description: "Filter by symbol kind: class, interface, function, method, struct, enum, etc." },
      limit: { type: "integer", description: "Max results (default 50)." },
      in_file: { type: "string", description: "Restrict to files whose path contains this substring." },
      module: { type: "string", description: "Restrict to files whose path starts with this prefix." },
      fuzzy: { type: "boolean", description: "Enable typo-tolerant fuzzy matching." },
      with_content: { type: "boolean", description: "Include each matched symbol's bounded source body. Default false." },
    },
    argv(args) {
      const a = ["symbol"];
      if (args.name) a.push(args.name);
      str(a, args.pattern, "--pattern");
      str(a, args.kind, "--type");
      num(a, args.limit, "--limit");
      str(a, args.in_file, "--in-file");
      str(a, args.module, "--module");
      bool(a, args.fuzzy, "--fuzzy");
      bool(a, args.with_content, "--with-content");
      return a;
    },
  },
  {
    name: "class",
    description: "Find classes, interfaces, objects, enums, protocols, structs, actors, or packages by name or glob pattern. A type-filtered `symbol` lookup. Use this for 'where is class X defined' questions.",
    parameters: {
      name: { type: "string", description: "Class/interface/type name. Use either 'name' or 'pattern', not both." },
      pattern: { type: "string", description: "Glob pattern (e.g. '*Controller', '*Handler*')." },
      limit: { type: "integer", description: "Max results (default 50)." },
      in_file: { type: "string", description: "Restrict to files whose path contains this substring." },
      module: { type: "string", description: "Restrict to files whose path starts with this prefix." },
      fuzzy: { type: "boolean", description: "Enable typo-tolerant fuzzy matching." },
    },
    argv(args) {
      const a = ["class"];
      if (args.name) a.push(args.name);
      str(a, args.pattern, "--pattern");
      num(a, args.limit, "--limit");
      str(a, args.in_file, "--in-file");
      str(a, args.module, "--module");
      bool(a, args.fuzzy, "--fuzzy");
      return a;
    },
  },
  {
    name: "hierarchy",
    description: "Show the inheritance tree for a class — both its superclasses/protocols it conforms to AND its subclasses/implementors. Complements `implementations` (which only shows one direction). Use this to understand the full inheritance neighborhood of a type.",
    parameters: {
      name: { type: "string", required: true, description: "Class, interface, protocol, trait, or abstract class name." },
      in_file: { type: "string", description: "Restrict to a specific file — useful when multiple classes share the same name." },
      module: { type: "string", description: "Restrict to files whose path starts with this prefix." },
    },
    argv(args) {
      const a = ["hierarchy", args.name];
      str(a, args.in_file, "--in-file");
      str(a, args.module, "--module");
      return a;
    },
  },
  {
    name: "imports",
    description: "List all imports / uses / includes declared in a source file. Fast way to understand a file's dependency fan-out without reading the file itself.",
    parameters: {
      file: { type: "string", required: true, description: "Path to the source file (relative to project root or absolute)." },
    },
    argv(args) {
      return ["imports", args.file];
    },
  },
  {
    name: "api",
    description: "Show the public API (exported symbols) of a module — classes, functions, interfaces visible from outside the module. Use this when planning a refactor or writing a changelog entry.",
    parameters: {
      module_path: { type: "string", required: true, description: "Module path or directory prefix (e.g. 'src/auth', 'com.example.billing')." },
      limit: { type: "integer", description: "Max results (default 100)." },
    },
    argv(args) {
      const a = ["api", args.module_path];
      num(a, args.limit, "--limit");
      return a;
    },
  },
  {
    name: "changed",
    description: "Summarize files changed on the current Git/Arc branch from merge-base(base, HEAD) to HEAD; staged and unstaged working-tree edits are not included. Returns repo-relative current paths with A/M/D/R statuses and `old_path` for renames. This is branch-level file metadata, not changed symbols or a replacement for a raw VCS diff. It is independent of the ast-index database/cache.",
    parameters: {
      base: { type: "string", description: "Base branch or revision. The comparison is merge-base(base, HEAD) to HEAD. Omit to resolve Git origin/HEAD, then try origin/main, origin/master, main, master, and trunk; Arc uses trunk." },
      timeout_ms: { type: "integer", description: "VCS command timeout in milliseconds (default 30000)." },
    },
    argv(args) {
      const a = ["changed"];
      str(a, args.base, "--base");
      num(a, args.timeout_ms, "--timeout-ms");
      return a;
    },
  },
  {
    name: "module",
    description: "Find modules matching a pattern. A module is the coarse unit above file — Gradle subproject, Cargo crate, Python package, Go package, etc. Use this to orient yourself in a large monorepo before drilling into files.",
    parameters: {
      pattern: { type: "string", required: true, description: "Glob or substring to match module paths." },
      limit: { type: "integer", description: "Max results (default 50)." },
    },
    argv(args) {
      const a = ["module", args.pattern];
      num(a, args.limit, "--limit");
      return a;
    },
  },
  {
    name: "deps",
    description: "Show what a given module depends on (its dependency list). Complements `dependents` which goes the other direction. Use for 'what does moduleX pull in' questions.",
    parameters: {
      module: { type: "string", required: true, description: "Module path (as returned by `module`)." },
    },
    argv(args) {
      return ["deps", args.module];
    },
  },
  {
    name: "dependents",
    description: "Reverse-deps: which modules depend on this one. Use this for impact analysis — 'if I refactor module X, what else breaks'. Critical before any module-level API change.",
    parameters: {
      module: { type: "string", required: true, description: "Module path." },
    },
    argv(args) {
      return ["dependents", args.module];
    },
  },
  {
    name: "call_tree",
    description: "Recursive caller tree — shows callers of a function, then THEIR callers, up to a configurable depth. Use for understanding how deep a function's usage reaches without chasing references by hand.",
    parameters: {
      function: { type: "string", required: true, description: "Function or method name." },
      depth: { type: "integer", description: "Max tree depth (default 3)." },
      limit: { type: "integer", description: "Max callers per level (default 10)." },
    },
    argv(args) {
      const a = ["call-tree", args.function];
      num(a, args.depth, "--depth");
      num(a, args.limit, "--limit");
      return a;
    },
  },
  {
    name: "graph_dependents",
    description: "Call BEFORE changing a symbol's name, signature or behaviour: who depends on it, from the precomputed symbol graph. `depth` 1 (default): direct dependents with resolution confidence; 2-3: transitive blast radius per hop. Unlike `usages`, edges point at one definition, so same-named symbols stay out. Best resolved for Ruby and JS/TS; elsewhere confirm 'no dependents' with `usages`. Missing or stale graph: add `refresh: true`.",
    parameters: {
      symbol: { type: "string", required: true, description: "Name, `Outer::Name`, or `Class#member` (e.g. `Billing::Invoice#total`)." },
      depth: { type: "integer", description: "1 (default): direct dependents. 2+: transitive impact per hop." },
      members: { type: "boolean", description: "For a class, also cover the definitions inside it." },
      include_ambiguous: { type: "boolean", description: "Also list/follow references whose name matched several definitions (upper bound)." },
      exclude_tests: { type: "boolean", description: "Leave out dependents defined in test files." },
      in_file: { type: "string", description: "Only definitions whose path contains this substring." },
      kind: { type: "string", description: "Only definitions of this kind: class, function, property, ..." },
      limit: { type: "integer", description: "Max rows (default 50)." },
      refresh: { type: "boolean", description: "Rebuild the graph first if it is missing or stale; no-op when fresh." },
    },
    argv(args) {
      const symbol = args.symbol;
      const depth = args.depth ?? 1;
      const a = depth > 1 ? ["graph", "impact", symbol, "--depth", String(depth)] : ["graph", "dependents", symbol];
      str(a, args.in_file, "--in-file");
      str(a, args.kind, "--kind");
      bool(a, args.members, "--members");
      bool(a, args.include_ambiguous, "--include-ambiguous");
      num(a, args.limit, "--limit");
      bool(a, args.refresh, "--refresh");
      bool(a, args.exclude_tests, "--exclude-tests");
      return a;
    },
  },
  {
    name: "graph_dependencies",
    description: "What a symbol's definition references (classes, methods, constants), each resolved to one definition with confidence — what it pulls in before you move, extract or stub it. For a class pass `members: true` (calls live in its methods). Same graph, caveats and `refresh` as `graph_dependents`.",
    parameters: {
      symbol: { type: "string", required: true, description: "Name, `Outer::Name`, or `Class#member`." },
      members: { type: "boolean", description: "For a class, also cover every definition inside it." },
      include_ambiguous: { type: "boolean", description: "Also list references whose name matched several definitions." },
      in_file: { type: "string", description: "Only definitions whose path contains this substring." },
      kind: { type: "string", description: "Only definitions of this kind: class, function, property, ..." },
      limit: { type: "integer", description: "Max rows (default 50)." },
      refresh: { type: "boolean", description: "Rebuild the graph first if it is missing or stale." },
    },
    argv(args) {
      const a = ["graph", "dependencies", args.symbol];
      str(a, args.in_file, "--in-file");
      str(a, args.kind, "--kind");
      bool(a, args.members, "--members");
      bool(a, args.include_ambiguous, "--include-ambiguous");
      num(a, args.limit, "--limit");
      bool(a, args.refresh, "--refresh");
      return a;
    },
  },
  {
    name: "graph_path",
    description: "How does A reach B? Shortest dependency path(s) from `from` to `to`, hop by hop with edge confidence. A class stands for itself and its methods (`contains` hops); if only `to` reaches `from`, the reverse path is shown. Same graph and `refresh` as `graph_dependents`.",
    parameters: {
      from: { type: "string", required: true, description: "Starting symbol (e.g. an entry point)." },
      to: { type: "string", required: true, description: "Destination symbol." },
      from_file: { type: "string", description: "Only `from` definitions whose path contains this substring." },
      to_file: { type: "string", description: "Only `to` definitions whose path contains this substring." },
      max_depth: { type: "integer", description: "Give up beyond this many hops (default 8)." },
      max_paths: { type: "integer", description: "Max shortest paths to list (default 3)." },
      include_ambiguous: { type: "boolean", description: "Also follow references whose name matched several definitions." },
      refresh: { type: "boolean", description: "Rebuild the graph first if it is missing or stale." },
    },
    argv(args) {
      const a = ["graph", "path", args.from, args.to];
      str(a, args.from_file, "--from-file");
      str(a, args.to_file, "--to-file");
      num(a, args.max_depth, "--max-depth");
      num(a, args.max_paths, "--max-paths");
      bool(a, args.include_ambiguous, "--include-ambiguous");
      bool(a, args.refresh, "--refresh");
      return a;
    },
  },
  {
    name: "graph_metrics",
    description: "Centrality from the symbol graph. Without `symbols`: the most central symbols, to orient in an unfamiliar repo. With `symbols`: their fan-in, fan-out, dependents and PageRank percentile — how load-bearing before you touch them. Same graph and `refresh` as `graph_dependents`.",
    parameters: {
      symbols: { type: "array", items: { type: "string" }, description: "Symbols to measure. Omit to list the most central ones." },
      sort: { type: "string", enum: ["pagerank", "fan-in", "fan-out", "dependents"], description: "Top list only: ranking key (default pagerank)." },
      kind: { type: "string", description: "Only symbols of this kind: class, function, ..." },
      path: { type: "string", description: "Top list only: symbols under this path prefix." },
      exclude_tests: { type: "boolean", description: "Top list only: skip symbols defined in test files." },
      in_file: { type: "string", description: "With `symbols` only: definitions whose path contains this substring." },
      limit: { type: "integer", description: "Max rows (default 20 for the top list, 50 with `symbols`)." },
      refresh: { type: "boolean", description: "Rebuild the graph first if it is missing or stale." },
    },
    argv(args) {
      const symbols = args.symbols && args.symbols.length > 0 ? args.symbols : [];
      const a = ["graph"];
      if (symbols.length === 0) {
        if (args.in_file) throw new Error("'in_file' applies only with 'symbols'; filter the top list with 'path'");
        a.push("top");
        str(a, args.sort, "--sort");
        num(a, args.limit, "--limit");
        str(a, args.kind, "--kind");
        str(a, args.path, "--path");
        bool(a, args.exclude_tests, "--exclude-tests");
      } else {
        for (const key of ["sort", "path", "exclude_tests"]) {
          if (args[key] !== undefined && args[key] !== null && args[key] !== false && args[key] !== "") {
            throw new Error(`'${key}' applies only to the top list; omit 'symbols' or drop '${key}'`);
          }
        }
        a.push("metrics", ...symbols);
        str(a, args.in_file, "--in-file");
        str(a, args.kind, "--kind");
        num(a, args.limit, "--limit");
      }
      bool(a, args.refresh, "--refresh");
      return a;
    },
  },
  {
    name: "graph_cycles",
    description: "Dependency cycles (strongly connected components over resolved edges), largest first, each with one concrete cycle — for untangling architecture. Same graph and `refresh` as `graph_dependents`.",
    parameters: {
      path: { type: "string", description: "Only components with a member under this path prefix." },
      min_size: { type: "integer", description: "Smallest component size to report (default 2)." },
      limit: { type: "integer", description: "Max components (default 20)." },
      refresh: { type: "boolean", description: "Rebuild the graph first if it is missing or stale." },
    },
    argv(args) {
      const a = ["graph", "cycles"];
      num(a, args.limit, "--limit");
      num(a, args.min_size, "--min-size");
      str(a, args.path, "--path");
      bool(a, args.refresh, "--refresh");
      return a;
    },
  },
  {
    name: "graph_build",
    description: "Build the symbol graph that the `graph_*` tools and `search` `rank` (proven, risky, central) read — only when one of them reports it missing or stale (`graph_*` tools can take `refresh: true` instead). Seconds even on a large monorepo; `rebuild` and `update` never build it.",
    parameters: {},
    argv() {
      return ["graph", "build"];
    },
  },
  {
    name: "hotspots",
    description: "Git-history risk per file — commits, churn, bugfix share, authors, age, last change — labelled by percentiles within this repository. Use before editing a file, when scoping a refactor, or with `sort: fixes` to find where bugs keep landing. Reads collected history only: collect with `ast-index hotspots --collect` in a shell (the first run reads the whole history, later ones are incremental).",
    parameters: {
      sort: { type: "string", enum: ["score", "commits", "churn", "relative-churn", "fixes", "authors", "recent"], description: "Ranking key. score (default): mean percentile of commits, churn and bugfix ratio; fixes: bugfix share discounted for thin history." },
      path: { type: "string", description: "Only files whose path starts with this prefix." },
      min_commits: { type: "integer", description: "Skip files with fewer commits (default 1)." },
      exclude_tests: { type: "boolean", description: "Leave test files out of the list; percentiles still rank every file." },
      limit: { type: "integer", description: "Max files (default 20)." },
    },
    argv(args) {
      const a = ["hotspots"];
      num(a, args.limit, "--limit");
      num(a, args.min_commits, "--min-commits");
      str(a, args.path, "--path");
      str(a, args.sort, "--sort");
      bool(a, args.exclude_tests, "--exclude-tests");
      return a;
    },
  },
  {
    name: "find_file",
    description: "Find files in the indexed project by name pattern. Much cheaper than listing a directory tree when you only need a few matches (e.g. 'where is PaymentViewModel.kt').",
    parameters: {
      pattern: { type: "string", required: true, description: "File name substring, or full name when 'exact' is true." },
      exact: { type: "boolean", description: "Match the file name exactly instead of as a substring." },
      limit: { type: "integer", description: "Max results (default 20)." },
    },
    argv(args) {
      const a = ["file", args.pattern];
      bool(a, args.exact, "--exact");
      num(a, args.limit, "--limit");
      return a;
    },
  },
  {
    name: "stats",
    description: "Show index statistics: detected project type, counts of files / symbols / refs / modules, DB size, extra roots. Call this to verify the index is populated and up-to-date before other queries.",
    parameters: {},
    argv() {
      return ["stats"];
    },
  },
  {
    name: "rebuild",
    description: "Rebuild the code index from scratch. Only needed on first setup or if `update` (incremental) is producing stale results. This can take minutes on large repositories — prefer `update` for everyday use (run it manually between sessions, NOT via this tool).",
    parameters: {},
    argv() {
      return ["rebuild"];
    },
  },
  {
    name: "update",
    description: "Incrementally update the code index — reindex only changed and deleted files since the last run. Fast (seconds) even on large repos. Call this instead of `rebuild` whenever you suspect the index is slightly stale.",
    parameters: {},
    argv() {
      return ["update"];
    },
  },
];
//#endregion

//#region spawn execution
/**
 * Run one `ast-index` command as a foreground spawn through `ctx.subprocess`
 * and return its complete stdout text. The working directory is the calling
 * agent's session current directory (ast-index auto-detects its project root
 * by walking up to `.git`/build markers). Exit 0 is success; anything else is
 * a typed {@link HarnessError} carrying the retained stderr tail.
 *
 * @param ctx - the plugin context; execution uses its `subprocess` service.
 * @param exec - the tool-execution context; supplies the owning Agent and abort signal.
 * @param bin - the resolved ast-index executable.
 * @param argv - the complete ast-index argument vector (without the binary).
 * @param caps - the deployment's resolved runtime caps.
 * @returns the complete stdout text.
 */
async function runAstIndex(ctx, exec, bin, argv, caps) {
  if (exec.signal.aborted) {
    throw new HarnessError("ast-index was aborted before completion (tool timeout or caller cancellation)", "AST_INDEX_ABORTED");
  }
  const workdir = exec.agent === undefined ? process.cwd() : await ctx.workingDirectory.ensure(exec.agent, exec.signal);
  let handle;
  try {
    handle = ctx.subprocess.spawn({
      argv: [bin, ...argv],
      cwd: workdir,
      stdio: {
        stdin: "ignore",
        stdout: { maxBytes: caps.rawOutputMaxBytes },
        stderr: { maxBytes: caps.stderrMaxBytes },
      },
      graceMs: caps.graceMs,
      signal: exec.signal,
    });
  } catch (error) {
    if (exec.signal.aborted) {
      throw new HarnessError("ast-index was aborted before completion (tool timeout or caller cancellation)", "AST_INDEX_ABORTED");
    }
    throw new HarnessError(`ast-index could not start its command (is "${bin}" installed and on PATH?)`, "AST_INDEX_FAILED", { cause: error });
  }
  const outcome = await handle.done;
  const stdout = handle.collected?.stdout?.readFrom(0);
  const stderr = handle.collected?.stderr?.readFrom(0);
  if (stdout === undefined) {
    throw new HarnessError("ast-index command produced no collected stdout stream", "AST_INDEX_FAILED");
  }
  if (exec.signal.aborted) {
    throw new HarnessError("ast-index was aborted before completion (tool timeout or caller cancellation)", "AST_INDEX_ABORTED");
  }
  if (outcome.signal !== null || outcome.exitCode === null) {
    throw new HarnessError(`ast-index command was killed by signal ${outcome.signal ?? "(unknown)"}`, "AST_INDEX_FAILED");
  }
  if (outcome.exitCode !== 0) {
    const tail = (stderr?.text ?? "").trim();
    throw new HarnessError(`ast-index exited with ${outcome.exitCode}${tail.length > 0 ? `: ${tail}` : ""}`, "AST_INDEX_FAILED");
  }
  return stdout.text;
}
//#endregion

//#region plugin entry
/**
 * Register the ast-index structural-navigation tool suite. The `ast-index`
 * binary must be installed and reachable (via `bin` config or
 * `AST_INDEX_BIN`, else `ast-index` on PATH); registration is unconditional
 * and the binary is located per call, so a missing binary surfaces as a typed
 * tool error rather than a loader failure.
 *
 * @param ctx - plugin context; registrations are effects scoped to this plugin.
 * @param config - resolved plugin configuration from schemastery.
 */
async function apply(ctx, config) {
  const resolved = config;
  const bin = process.env.AST_INDEX_BIN || resolved.bin || "ast-index";
  const caps = {
    rawOutputMaxBytes: resolved.rawOutputMaxBytes,
    stderrMaxBytes: resolved.stderrMaxBytes,
    graceMs: resolved.graceMs,
  };

  for (const spec of TOOLS) {
    ctx.tools.register(defineTool({
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      timeoutMs: resolved.timeoutMs,
      output: {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            text: { type: "string", required: true },
          },
        },
        render: (_args, value) => [{ type: "text", text: value.text }],
      },
      async execute(args, exec) {
        const text = await runAstIndex(ctx, exec, bin, spec.argv(args), caps);
        return { text };
      },
    }));
  }
}
//#endregion

export { Config, apply, inject, name };
