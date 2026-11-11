import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve, sep } from 'node:path'

const require = createRequire(import.meta.url)

export function registerCli(ctx) {
  const packageName = `@ast-index/cli-${process.platform}-${process.arch}`
  let manifestPath
  try {
    manifestPath = require.resolve(`${packageName}/package.json`)
  } catch (cause) {
    throw new Error(
      `Missing ast-index platform package ${packageName}. Check that your registry provides it and install the plugin with optional dependencies enabled.`,
      { cause },
    )
  }

  const executable = resolve(dirname(manifestPath), require(manifestPath).bin['ast-index'])
  try {
    accessSync(executable, constants.X_OK)
  } catch (cause) {
    throw new Error(`Cannot execute the binary from ${packageName}: ${executable}`, { cause })
  }

  // Forward slashes work in both PowerShell and Git Bash on Windows.
  const shellPath = executable.split(sep).join('/')
  return ctx.shellEnv.register({
    name: 'ast-index',
    variables: {
      DSH_AST_INDEX_BIN: { description: 'Absolute path to the ast-index executable for this shell.' },
    },
    resolve: () => ({ DSH_AST_INDEX_BIN: shellPath }),
  })
}
