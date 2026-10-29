# @deepseek-ai/dsh-tool-ast-index

Model-facing structural code-navigation tools for the DeepSeek Harness (dsh).
This Cordis plugin wraps the [`ast-index`](https://github.com/defendend/Claude-ast-index-search)
CLI and exposes its symbol / reference / call-graph queries as first-class dsh
tools, so a coding agent navigates by exact structure instead of `grep`-style
text matches.

## What it provides

28 tools mirroring the [`ast-index-mcp`](../crates/ast-index-mcp) server:

| Group | Tools |
|-------|-------|
| Discovery | `explore`, `search`, `symbol`, `class`, `find_file`, `outline` |
| References | `usages`, `callers`, `call_tree`, `refs`, `implementations`, `hierarchy`, `imports` |
| Modules | `module`, `deps`, `dependents`, `api` |
| Symbol graph | `graph_dependents`, `graph_dependencies`, `graph_path`, `graph_metrics`, `graph_cycles`, `graph_build` |
| Change & risk | `changed`, `hotspots` |
| Index management | `stats`, `rebuild`, `update` |

Every tool runs `ast-index <subcommand> …` in the agent's session working
directory and returns the compact text output directly — token-efficient and
follow-up-readable with dsh's `read` tool.

## Install

### 1. Build / install the `ast-index` binary

The plugin only spawns the CLI; it does not bundle it.

```bash
cargo install --locked --path .            # from this repository
# or a prebuilt channel:
brew install ast-index                     # macOS/Linux
winget install --id defendend.ast-index    # Windows
```

Then index your project once:

```bash
cd /path/to/project
ast-index rebuild
```

### 2. Mount the plugin

Add the package to your dsh plugin composition. In a `dsh.yml` / loader
composition, alongside the subprocess backend and the other tools:

```yaml
- name: '@deepseek-ai/dsh-subprocess-local'
- name: '@deepseek-ai/dsh-tool-ast-index'
  config:
    bin: ast-index
```

The plugin injects `tools`, `subprocess`, and `workingDirectory`, so those
services must be present in the same composition (they are in the standard
desktop runtime).

## Configuration

| Key | Default | Meaning |
|-----|---------|---------|
| `bin` | `ast-index` | Executable name or absolute path. Overridden by `AST_INDEX_BIN` env var. |
| `timeoutMs` | `30000` | Cooperative tool-call timeout budget (ms). |
| `rawOutputMaxBytes` | `20000000` | Cap on complete raw stdout per call. |
| `stderrMaxBytes` | `65536` | Retained stderr diagnostic tail. |
| `graceMs` | `3000` | Terminate-escalation grace period (ms). |

## Design notes

- **Spawn-backed, not a shell.** Tools execute through `ctx.subprocess.spawn()`
  with a plain argv vector — never `ctx.shell` — so no shell quoting applies.
- **Text mode.** The plugin does not pass `--format json`; it returns the CLI's
  own compact text output. Structured/JSON output is a possible follow-up.
- **Working directory = project root.** Each call runs in the agent's session
  working directory; `ast-index` auto-detects its project root by walking up.
- **Errors are typed.** Non-zero exits surface as `HarnessError` with code
  `AST_INDEX_FAILED` / `AST_INDEX_ABORTED` and a stderr tail.

## License

MIT
