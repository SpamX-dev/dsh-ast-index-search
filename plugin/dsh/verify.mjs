import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const tarball = process.argv[2]
assert.ok(tarball, 'Usage: node plugin/dsh/verify.mjs <plugin.tgz>')
const source = fileURLToPath(new URL('../', import.meta.url))
const skillDir = 'skills/ast-index'
const references = readdirSync(join(source, skillDir, 'references')).filter(name => name.endsWith('.md')).sort()
assert.ok(references.length > 0, 'Missing source references')
const sharedFiles = [`${skillDir}/SKILL.md`, ...references.map(name => `${skillDir}/references/${name}`)]
const runtimeFiles = ['package.json', 'dsh/index.mjs', 'dsh/cli.mjs', 'dsh/cordis.patch.yml', ...sharedFiles]

const entries = execFileSync('tar', ['-tf', resolve(tarball)], { encoding: 'utf8' }).trim().split(/\r?\n/)
const files = entries.filter(entry => !entry.endsWith('/')).map(entry => entry.replace(/^package\//, ''))
assert.deepEqual(files.filter(file => !/^(?:README(?:\.md)?|LICENSE(?:\.md)?)$/i.test(file)).sort(), runtimeFiles.sort())

const temp = mkdtempSync(join(tmpdir(), 'dsh-ast-index-'))
try {
  const profile = join(temp, 'profile with spaces')
  const project = join(temp, 'sample project')
  mkdirSync(profile)
  mkdirSync(project)
  copyFileSync(tarball, join(profile, 'plugin.tgz'))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({
    private: true,
    dependencies: {
      'dsh-ast-index': 'file:./plugin.tgz',
      '@deepseek-ai/dsh-shell-env': '0.2.2-rc.1',
      '@deepseek-ai/dsh-skill-filesystem': '0.2.2-rc.1',
      yaml: '^2.4.2',
    },
  }))
  // Static command so paths and registry credentials never need shell quoting.
  execSync('npm install --include=optional --ignore-scripts --no-audit --no-fund', { cwd: profile, stdio: 'inherit' })
  const host = createRequire(join(profile, 'package.json'))
  const entry = host.resolve('dsh-ast-index')
  const installed = dirname(host.resolve('dsh-ast-index/package.json'))
  const plugin = createRequire(entry)
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))

  // The plugin can stay on a published CLI release while the Rust tree moves on.
  const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-x64']
  const nativeNames = platforms.map(target => {
    const metadata = JSON.parse(readFileSync(join(source, '../npm/platforms', target, 'package.json'), 'utf8'))
    return metadata.name
  })
  assert.deepEqual(Object.keys(manifest.optionalDependencies).sort(), nativeNames.sort())
  const versions = [...new Set(Object.values(manifest.optionalDependencies))]
  assert.equal(versions.length, 1, 'All native binaries must use the same CLI release')
  assert.match(versions[0], /^\d+\.\d+\.\d+$/, 'Pin a published CLI version')
  for (const file of sharedFiles) {
    assert.deepEqual(readFileSync(join(installed, file)), readFileSync(join(source, file)), file)
  }

  const load = name => import(pathToFileURL(host.resolve(name)))
  const { Context } = await load('@deepseek-ai/cordis')
  const { SkillRegistry } = await load('@deepseek-ai/dsh-skill')
  const shellEnv = await load('@deepseek-ai/dsh-shell-env')
  const { parse } = await load('yaml')
  const patch = parse(readFileSync(join(installed, manifest.dsh.bundle.patch), 'utf8'))
  const registration = patch.flatMap(operation => operation.insert ?? []).find(record => record.name === manifest.name)
  assert.ok(registration, 'The Harness bundle patch must register this package')
  const ctx = new Context()
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(shellEnv, { dshHome: profile })
  const fiber = await ctx.plugin(await load(registration.name))
  try {
    const skill = await ctx.skills.get('ast-index', { cwd: project })
    assert.equal(skill?.source, 'bundled', 'Harness could not load the bundled ast-index skill')
    assert.equal(skill.invocation.modelInvocable, true)
    assert.equal(skill.invocation.userInvocable, false)
    assert.equal(skill.resourceBase.kind, 'directory')
    assert.equal(resolve(skill.resourceBase.path), resolve(installed, skillDir))
    assert.match(skill.content, /DSH_AST_INDEX_BIN/)

    const shell = ctx.shellEnv.collect({})
    const nativeName = `@ast-index/cli-${process.platform}-${process.arch}`
    for (const name of nativeNames.filter(name => name !== nativeName)) {
      assert.throws(() => plugin.resolve(`${name}/package.json`), { code: 'MODULE_NOT_FOUND' })
    }
    const metadataPath = plugin.resolve(`${nativeName}/package.json`)
    const metadata = plugin(metadataPath)
    assert.equal(metadata.version, manifest.optionalDependencies[nativeName])
    assert.equal(resolve(shell.DSH_AST_INDEX_BIN), resolve(dirname(metadataPath), metadata.bin['ast-index']))

    writeFileSync(join(project, 'package.json'), '{"name":"sample-project","private":true}\n')
    writeFileSync(join(project, 'sample.ts'), 'export function packagedSymbol() { return 42 }\n')
    const options = { cwd: project, encoding: 'utf8', env: { ...process.env, ...shell, AST_INDEX_CACHE_DIR: join(temp, 'index-cache') } }
    const run = args => process.platform === 'win32'
      ? execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `& $env:DSH_AST_INDEX_BIN ${args}; exit $LASTEXITCODE`], options)
      : execFileSync('sh', ['-c', `exec "$DSH_AST_INDEX_BIN" ${args}`], options)
    run('rebuild')
    const { items } = JSON.parse(run('symbol packagedSymbol --format json'))
    assert.ok(items.some(item => item.name === 'packagedSymbol' && basename(item.path) === 'sample.ts' && item.line === 1))
  } finally {
    await fiber.dispose()
  }
  assert.equal(ctx.shellEnv.collect({}).DSH_AST_INDEX_BIN, undefined)
  assert.equal(await ctx.skills.get('ast-index', { cwd: project }), undefined)
  console.log(`Verified packaged skill, ${references.length} references and native symbol search on ${process.platform}-${process.arch}.`)
} finally {
  rmSync(temp, { recursive: true, force: true, maxRetries: 3 })
}
