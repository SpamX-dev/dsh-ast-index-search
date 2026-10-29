# ast-index — structural code search

Use the ast-index tools for any code / symbol search in this project, BEFORE
`grep`, ripgrep, or reading whole files. They query a precomputed SQLite index
of definitions, references and files — structural, language-aware, and far
cheaper in tokens and round-trips than a grep + read loop.

## Critical rules (mandatory)

1. **ast-index is the PRIMARY search tool** — use it before grep/ripgrep/`read`.
2. **Pick the tool by what you know:**
   - A question, an intent, or a description ("how is auth handled", "where is
     payment processed") → **`explore` first**. One call returns ranked symbols
     + outline/source + callers/subclasses + tests.
   - An exact identifier (`UserService`, `parseConfig`) → **`search` / `symbol` /
     `class`**. Add `with_content` when you need a symbol's body.
   - "Who uses X" → **`usages`**. "Where is X called" → **`callers`**. "Who
     depends on this definition" → **`graph_dependents`**.
   - "What implements Y" → **`implementations`**. "Inheritance tree" →
     **`hierarchy`**.
   - "Structure of a file" → **`outline`** (always before `read` on files over
     ~500 lines). "What a file imports" → **`imports`**.
3. **Do not duplicate results** — if ast-index returned usages/implementations,
   that IS the complete answer.
4. **Do not run grep "for completeness"** after ast-index returned results.
5. **Do not re-read `with_content` bodies** — a successful result replaces the
   follow-up file-read. Read again only when the body was truncated or you need
   text outside the returned definition.
6. **Use grep/`read` only when:** ast-index returns empty, you need a regex
   (ast-index matches literally), a string literal inside code, or comments
   content (usages/refs skip strings and comments).

## Setup and freshness

- **`rebuild`** once per project to create the index (or shell
  `ast-index rebuild`). Prefer **`update`** (incremental) for everyday staleness.
- **`stats`** to verify the index is populated and current.
- **`graph_build`** once (or `refresh: true` on a graph query) to enable the
  `graph_*` tools and `search` ranking presets.
- **`hotspots`** reads Git history: collect it first with
  `ast-index hotspots --collect` in a shell (the first run is slow; later runs
  are incremental).

## Tool reference

All tools accept `project_root` (absolute workspace path); omit it to use the
server's startup root. Pass it when the agent is working in a directory the
server was not started in.

### Discovery

- **`explore`** — FIRST for "how does X work" / "where/what is X". Args: `query`
  (required), `max_files`, `rwr` (re-rank via call/inheritance graph).
- **`search`** — literal search over paths/definitions/imports/contents for a
  known identifier or path fragment. Args: `query` (required), `limit`, `kind`,
  `in_file`, `module`, `fuzzy`, `rank`, `exclude_tests`, `with_content`.
  A multi-word query with no literal hit falls back to `explore` ranking.
- **`symbol`** — exact name or glob pattern, optionally filtered by `kind`.
  Args: `name` or `pattern`, `kind`, `limit`, `in_file`, `module`, `fuzzy`,
  `with_content`.
- **`class`** — classes/interfaces/enums/etc. by name or `pattern`. Args:
  `name` or `pattern`, `limit`, `in_file`, `module`, `fuzzy`.
- **`find_file`** — files by name `pattern` (substring, or exact with
  `exact: true`). Args: `pattern` (required), `exact`, `limit`.
- **`outline`** — symbols with line ranges of one file. Args: `file` (required).

### References

- **`usages`** — every indexed reference to a `symbol` name (call, type use,
  import) as file:line + text. Args: `symbol` (required), `limit`, `in_file`,
  `module`. Matched by name, not resolved by type.
- **`callers`** — call sites of a `function` by name. Args: `function`
  (required), `limit`. For the calling function and callers-of-callers use
  `call_tree`.
- **`call_tree`** — recursive caller tree. Args: `function` (required),
  `depth`, `limit`.
- **`refs`** — definitions + imports + usages in one shot. Args: `symbol`
  (required), `limit`.
- **`implementations`** — every type that implements/extends `parent`. Args:
  `parent` (required), `with_content`, `limit`, `in_file`, `module`.
- **`hierarchy`** — full inheritance tree of a type. Args: `name` (required),
  `in_file`, `module`.
- **`imports`** — imports/uses/includes of a file. Args: `file` (required).

### Modules

- **`module`** — find modules (Gradle/Cargo/package/etc.) by `pattern`.
  Args: `pattern` (required), `limit`.
- **`deps`** — what a `module` depends on. Args: `module` (required).
- **`dependents`** — reverse deps: which modules depend on `module`.
  Args: `module` (required).
- **`api`** — public API of a module. Args: `module_path` (required), `limit`.

### Symbol graph (precomputed; `refresh: true` rebuilds if stale)

- **`graph_build`** — build the graph (explicit; `rebuild`/`update` never do).
- **`graph_dependents`** — who depends on a symbol, BEFORE changing its name or
  signature. Args: `symbol` (required), `depth` (1 = direct, 2+ = transitive
  blast radius), `members`, `include_ambiguous`, `exclude_tests`, `in_file`,
  `kind`, `limit`, `refresh`.
- **`graph_dependencies`** — what a symbol references. Same args as
  `graph_dependents`.
- **`graph_path`** — shortest dependency path(s) `from` → `to`. Args: `from`,
  `to` (required), `from_file`, `to_file`, `max_depth`, `max_paths`,
  `include_ambiguous`, `refresh`.
- **`graph_metrics`** — centrality. Without `symbols`: most central symbols;
  with `symbols`: fan-in/out/dependents/PageRank. Args: `symbols`, `sort`,
  `kind`, `path`, `exclude_tests`, `in_file`, `limit`, `refresh`.
- **`graph_cycles`** — dependency cycles. Args: `path`, `min_size`, `limit`,
  `refresh`.

### Change and risk

- **`changed`** — files changed on the current branch (merge-base → HEAD),
  A/M/D/R with `old_path` for renames. Args: `base`, `timeout_ms`. Reads VCS
  directly; independent of the index.
- **`hotspots`** — per-file Git-history risk (commits, churn, bugfix share,
  authors) labelled by in-repo percentiles. Args: `sort`, `path`, `min_commits`,
  `exclude_tests`, `limit`. Use before editing or scoping a refactor.

### Index management

- **`stats`** — index statistics (files/symbols/refs/modules, project type).
- **`rebuild`** — full reindex (first setup, or if `update` is stale). Slow on
  large repos.
- **`update`** — incremental reindex of changed files (fast).

## `search` ranking presets

`search` `rank` re-orders results by Git history + the symbol graph; exact name
matches stay first:

| Preset | Use case | Needs |
|--------|----------|-------|
| `proven` | a settled example to copy | `hotspots --collect` + `graph_build` |
| `hotspots` | keeps being changed and fixed | `hotspots --collect` |
| `risky` | dangerous to touch (many dependents + unstable history) | both |
| `central` | what the rest leans on (PageRank) | `graph_build` |

Missing data is never ranked as zeros: the preset is skipped and the output
names the command to run.

## Workflow

1. `rebuild` once per project; `update` afterwards.
2. For an area survey or a question → `explore`.
3. For a known name → `search` / `symbol` / `class`; `with_content` for bodies.
4. Before editing a symbol → `graph_dependents` (impact).
5. Before reading a large file → `outline`, then `read` by offset/limit.
6. Before a review → `changed`; before editing/scoping a refactor → `hotspots`.
