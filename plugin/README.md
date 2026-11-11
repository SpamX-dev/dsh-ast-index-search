# ast-index Agent Plugin

This directory is the shared payload for agent integrations.

## Supported Surfaces

- Claude Code: `.claude-plugin/plugin.json`, `commands/`, and `skills/`.
- Codex: `.codex-plugin/plugin.json` and `skills/`.
- DeepSeek Harness: the `dsh-ast-index` npm package, built from this directory.
- Cursor: `.cursor-plugin/plugin.json`, `skills/`, `rules/`, and
  `commands-cursor/`.

The Claude commands are intentionally separate from the Cursor command because
they write different project configuration files.

For Claude Code, use `/initialize` as the default entrypoint. It auto-detects
single-stack, KMP, and polyglot repos, then configures `.claude/settings.json`
and `.claude/rules/ast-index.md`. The platform-specific `/initialize-*`
commands remain available as manual overrides.

## DeepSeek Harness

For Desktop, open the app once to initialize the profile, then fully quit it.
Install the published package and reopen the app:

```sh
dsh plugin --profile desktop add dsh-ast-index
```

The package contains the shared `skills/ast-index/SKILL.md` and its
`references/` directory. It declares five optional platform packages from
the CLI release: Windows x64, Linux x64/arm64 and macOS x64/arm64. Keep
optional dependencies enabled: the package manager installs the matching
binary. No global `ast-index` installation is required. The skill invokes it
via `DSH_AST_INDEX_BIN`, which the plugin sets for the Harness shell.

**Build and test** from a checkout with Node.js 22 or later, npm and tar.
Run these commands from the repository root (create `dist/` first):

```sh
npm pack ./plugin --pack-destination ./dist
node plugin/dsh/verify.mjs dist/dsh-ast-index-0.1.0.tgz
```

To try that archive in Desktop before publishing, quit the app and run
`dsh plugin --profile desktop add file:./dist/dsh-ast-index-0.1.0.tgz`
from the repository root. Reopen Desktop to load the plugin.

On Windows, if Command Prompt reports that `dsh` is not recognized, you can
use the launcher shipped with a per-user Desktop installation. Run this from
the repository root in **cmd.exe**:

```bat
"%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add file:./dist/dsh-ast-index-0.1.0.tgz
```

The verifier installs the archive in a temporary profile, checks the installed
skill and every reference against the source files, and uses the native CLI
to index a sample project and find a symbol. The plugin has its own version
in `plugin/package.json`; when adopting a new CLI release, update the five
dependency pins together after publishing the native packages.

**Nexus:** publish the tarball to your hosted npm repository. For
installation, point Harness at the Nexus group using `--registry` as shown
below, or configure it in the user's `.npmrc`. Substitute your own URLs.
The group must serve `dsh-ast-index` and the five pinned `@ast-index/cli-*`
packages, either from hosted repositories or an npm proxy. Harness supplies
the skill provider; to run the standalone verifier in a disconnected network,
also mirror its Harness test dependencies. The plugin has no registry URL
or postinstall download script.

```sh
npm publish dist/dsh-ast-index-0.1.0.tgz --registry https://nexus.example/repository/npm-hosted/
dsh plugin --profile desktop add dsh-ast-index --registry=https://nexus.example/repository/npm-group/
```

See [Sonatype's npm registry configuration](https://help.sonatype.com/en/configuring-npm.html)
for the group URL and [publishing guide](https://help.sonatype.com/en/publishing-npm-packages.html).

## Local Testing

Codex can load the skill directly from `~/.codex/skills`:

```bash
mkdir -p ~/.codex/skills
ln -s /absolute/path/to/Claude-ast-index-search/plugin/skills/ast-index ~/.codex/skills/ast-index
```

The repo marketplace at `.agents/plugins/marketplace.json` is kept for Codex
builds that support plugin marketplaces.

Cursor can load the skill directly from `~/.cursor/skills`:

```bash
mkdir -p ~/.cursor/skills
ln -s /absolute/path/to/Claude-ast-index-search/plugin/skills/ast-index ~/.cursor/skills/ast-index
```

Cursor can load the plugin locally by symlinking this directory:

```bash
mkdir -p ~/.cursor/plugins/local
ln -s /absolute/path/to/Claude-ast-index-search/plugin ~/.cursor/plugins/local/ast-index
```

Then reload Cursor and verify the `ast-index` skill, rule, and
`initialize-ast-index` command appear. For Claude Code plugin testing, verify
that `/initialize` and the manual override `/initialize-*` commands appear.
