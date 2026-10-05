import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildReport, parseAudit, parseOutdated } from '../src/main/modules/health/deps'
import { HealthService, type HealthDeps } from '../src/main/modules/health/service'
import { firstLine, parseVer, satisfies, toolVersion } from '../src/main/modules/health/versions'

describe('reading versions', () => {
  it('finds the version in assorted output', () => {
    expect(parseVer('v20.11.0')).toEqual({ major: 20, minor: 11, patch: 0 })
    expect(parseVer('Python 3.11.4')).toEqual({ major: 3, minor: 11, patch: 4 })
    expect(parseVer('go version go1.22.1 darwin/arm64')).toEqual({ major: 1, minor: 22, patch: 1 })
    expect(parseVer('20')).toEqual({ major: 20, minor: null, patch: null })
    expect(parseVer('20.x')).toEqual({ major: 20, minor: null, patch: null })
    expect(parseVer('no digits')).toBeNull()
  })
  it('takes the first real line of a version file and reads .tool-versions', () => {
    expect(firstLine('# comment\n\n20.11.0\n')).toBe('20.11.0')
    expect(toolVersion('nodejs 20.1.0\npython 3.11.4\n', 'python')).toBe('3.11.4')
    expect(toolVersion('nodejs 20.1.0\n', 'nodejs', 'node')).toBe('20.1.0')
  })
})

describe('does the installed version satisfy what is asked', () => {
  const cases: Array<[string, string, boolean | null]> = [
    ['v20.11.0', '20', true], ['v20.11.0', 'v20', true], ['v18.19.0', '20', false], ['v20.11.0', '20.11', true], ['v20.11.0', '20.10', false], ['v20.11.0', '20.11.0', true], ['v20.11.1', '20.11.0', false],
    ['v20.11.0', '>=18', true], ['v16.0.0', '>=18', false], ['v18.0.0', '>=18.0.0', true], ['v20.0.0', '>18', true], ['v18.0.0', '>18', false], ['v18.2.0', '<=18.2.0', true], ['v18.3.0', '<18.3.0', false],
    ['v20.11.0', '^20.0.0', true], ['v21.0.0', '^20.0.0', false], ['v19.9.0', '^20.0.0', false], ['v0.3.5', '^0.3.1', true], ['v0.4.0', '^0.3.1', false],
    ['v20.11.0', '~20.11.0', true], ['v20.12.0', '~20.11.0', false], ['v20.5.0', '~20', true],
    ['v20.11.0', '20.x', true], ['v18.1.0', '20.x', false],
    ['v20.11.0', '>=18 <22', true], ['v22.1.0', '>=18 <22', false], ['v16.1.0', '^16 || ^18 || ^20', true], ['v17.0.0', '^16 || ^18 || ^20', false],
    ['Python 3.11.4', '>=3.10', true], ['Python 3.9.1', '>=3.10', false], ['Python 3.11.4', '>=3.10,<4', true], ['Python 3.11.4', '~=3.10', true], ['Python 3.9.0', '~=3.10', false], ['Python 3.11.4', '==3.11.*', true], ['Python 3.12.0', '==3.11.*', false],
    ['v20.0.0', 'lts/*', null], ['v20.0.0', 'node', null], ['v20.0.0', '', null], ['no version', '20', null], ['v20.0.0', '18 - 20', null]
  ]
  for (const [actual, wanted, expected] of cases) it(`${actual} vs "${wanted}" -> ${expected}`, () => expect(satisfies(actual, wanted)).toBe(expected))
})

describe('dependency reports', () => {
  it('reads npm and pnpm outdated output, flags new majors, and ignores up-to-date and uninstalled ones sensibly', () => {
    const npm = JSON.stringify({ react: { current: '18.2.0', wanted: '18.3.1', latest: '19.0.0' }, lodash: { current: '4.17.20', wanted: '4.17.21', latest: '4.17.21' }, vite: { current: 'MISSING', wanted: '5.0.0', latest: '5.0.0' }, same: { current: '1.0.0', wanted: '1.0.0', latest: '1.0.0' } })
    expect(parseOutdated(npm, { react: 'dependencies', lodash: 'devDependencies' })).toEqual([
      { name: 'react', current: '18.2.0', wanted: '18.3.1', latest: '19.0.0', type: 'dependencies', major: true },
      { name: 'lodash', current: '4.17.20', wanted: '4.17.21', latest: '4.17.21', type: 'devDependencies', major: false },
      { name: 'vite', current: '—', wanted: '5.0.0', latest: '5.0.0', type: 'dependencies', major: false }
    ])
    const pnpm = JSON.stringify({ zod: { current: '3.0.0', latest: '4.0.0', wanted: '3.0.0', dependencyType: 'devDependencies' } })
    expect(parseOutdated(pnpm)[0]).toMatchObject({ name: 'zod', type: 'devDependencies', major: true })
    expect(parseOutdated('')).toEqual([])
    expect(parseOutdated('garbage')).toEqual([])
  })
  it('summarises npm audit and pnpm audit, worst first', () => {
    const npm = JSON.stringify({ metadata: { vulnerabilities: { info: 0, low: 1, moderate: 1, high: 1, critical: 0, total: 3 } }, vulnerabilities: { a: { severity: 'low', via: ['b'] }, b: { severity: 'high', via: [{ title: 'Prototype pollution' }] }, c: { severity: 'moderate', via: [] } } })
    expect(parseAudit(npm).vulns).toEqual({ total: 3, critical: 0, high: 1, moderate: 1, low: 1, top: [{ name: 'b', severity: 'high', title: 'Prototype pollution' }, { name: 'c', severity: 'moderate', title: undefined }, { name: 'a', severity: 'low', title: undefined }] })
    const pnpm = JSON.stringify({ metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 1 } }, advisories: { 1: { module_name: 'x', severity: 'critical', title: 'RCE' } } })
    expect(parseAudit(pnpm).vulns).toMatchObject({ total: 1, critical: 1, top: [{ name: 'x', severity: 'critical', title: 'RCE' }] })
  })
  it('explains an audit that could not run instead of claiming "no vulnerabilities"', () => {
    expect(parseAudit(JSON.stringify({ error: { code: 'ENOLOCK', summary: 'This command requires an existing lockfile.' } }))).toEqual({ error: 'This command requires an existing lockfile.' })
    expect(parseAudit('not json').error).toBeTruthy()
    expect(parseAudit('{}').error).toBeTruthy()
  })
  it('builds a report that keeps the outdated list when only the audit failed', () => {
    const r = buildReport('npm', JSON.stringify({ a: { current: '1.0.0', latest: '1.1.0', wanted: '1.1.0' } }), JSON.stringify({ error: { summary: 'offline' } }), {})
    expect(r.outdated).toHaveLength(1)
    expect(r.vulns).toBeUndefined()
    expect(r.vulnError).toBe('offline')
  })
})

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
function project(files: Record<string, string>, dirsToMake: string[] = []) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-health-')))
  dirs.push(dir)
  for (const [n, c] of Object.entries(files)) writeFileSync(join(dir, n), c)
  for (const d of dirsToMake) {
    mkdirSync(join(dir, d), { recursive: true })
    writeFileSync(join(dir, d, 'f.txt'), 'x')
  }
  return dir
}
function service(dir: string, over: Partial<HealthDeps> & { versions?: Record<string, string>; tracked?: string[]; sizes?: Record<string, number>; trusted?: boolean; running?: boolean } = {}) {
  const calls: string[][] = []
  const deps: HealthDeps = {
    project: (id) => (id === 'p' ? { path: dir, trusted: over.trusted ?? true, name: 'web', hasGit: true } : undefined),
    version: async (bin) => over.versions?.[bin],
    size: async (path) => over.sizes?.[path.split('/').pop()!] ?? 10_000,
    git: async (_c, args) => (over.tracked?.includes(args.at(-1)!) ? args.at(-1)! : ''),
    isRunning: () => over.running ?? false,
    minKb: 1,
    runTolerant: over.runTolerant ?? (async (file, args) => (calls.push([file, ...args]), args[0] === 'outdated' ? '{}' : JSON.stringify({ metadata: { vulnerabilities: {} } }))),
    ...over
  }
  return { svc: new HealthService(deps), calls }
}

describe('tool version checks', () => {
  it('flags a Node that does not match .nvmrc and gives a hint, and passes when it matches', async () => {
    const dir = project({ '.nvmrc': '20\n' })
    const bad = (await service(dir, { versions: { node: 'v18.19.0' } }).svc.scan('p')).tools[0]
    expect(bad).toMatchObject({ tool: 'Node', wanted: '20', source: '.nvmrc', actual: '18.19.0', ok: false })
    expect(bad.hint).toMatch(/nvm use/)
    expect((await service(dir, { versions: { node: 'v20.11.0' } }).svc.scan('p')).tools[0]).toMatchObject({ ok: true, hint: undefined })
  })
  it('says "not installed" instead of guessing when the tool is missing', async () => {
    const t = (await service(project({ '.nvmrc': '20' }), { versions: {} }).svc.scan('p')).tools[0]
    expect(t).toMatchObject({ ok: null, actual: undefined })
    expect(t.hint).toMatch(/not found/)
  })
  it('reads engines.node, requires-python, .python-version, go.mod and packageManager', async () => {
    const dir = project({ 'package.json': JSON.stringify({ engines: { node: '>=18' }, packageManager: 'pnpm@9.1.0' }), 'pyproject.toml': '[project]\nrequires-python = ">=3.10"\n', 'go.mod': 'module x\n\ngo 1.22\n' })
    const tools = (await service(dir, { versions: { node: 'v20.0.0', python3: 'Python 3.9.0', go: 'go version go1.22.1 darwin/arm64', pnpm: '8.0.0' } }).svc.scan('p')).tools
    expect(tools.map((t) => [t.tool, t.ok])).toEqual([['Node', true], ['Python', false], ['Go', true], ['pnpm', false]])
    expect(tools.find((t) => t.tool === 'pnpm')!.hint).toMatch(/corepack/)
  })
  it('warns about two lockfiles, and about a lockfile for another manager than package.json names', async () => {
    const two = await service(project({ 'package.json': '{}', 'package-lock.json': '{}', 'pnpm-lock.yaml': '' })).svc.scan('p')
    expect(two.tools.find((t) => t.tool === 'Lockfiles')).toMatchObject({ ok: false, source: 'npm + pnpm' })
    const mismatch = await service(project({ 'package.json': JSON.stringify({ packageManager: 'pnpm@9.0.0' }), 'yarn.lock': '' }), { versions: { pnpm: '9.0.0' } }).svc.scan('p')
    expect(mismatch.tools.find((t) => t.tool === 'Lockfiles')).toMatchObject({ ok: false, actual: 'yarn' })
  })
  it('says nothing for a project that pins nothing', async () => {
    expect((await service(project({ 'package.json': '{}' })).svc.scan('p')).tools).toEqual([])
  })
})

describe('disk hogs and cleaning', () => {
  it('lists regenerable folders by size, skipping small, tracked and symlinked ones', async () => {
    const dir = project({ 'package.json': '{}', 'pnpm-lock.yaml': '' }, ['node_modules', 'dist', '.next', 'coverage', 'target'])
    mkdirSync(join(dir, 'real-cache'))
    symlinkSync(join(dir, 'real-cache'), join(dir, 'build'))
    const snap = await service(dir, { sizes: { node_modules: 500_000, dist: 20_000, '.next': 80_000, coverage: 0 }, tracked: ['dist'] }).svc.scan('p')
    expect(snap.hogs.map((h) => [h.name, h.sizeKb])).toEqual([['node_modules', 500_000], ['.next', 80_000]])
    expect(snap.hogs[0].regenerate).toBe('pnpm install')
    // `target` only counts in a Rust project
    expect(snap.hogs.some((h) => h.name === 'target')).toBe(false)
    expect((await service(project({ 'Cargo.toml': '' }, ['target'])).svc.scan('p')).hogs.map((h) => h.name)).toEqual(['target'])
  })
  it('deletes only an allowlisted, untracked, real folder inside a trusted, idle project', async () => {
    const dir = project({ 'package.json': '{}' }, ['node_modules', 'src'])
    const { svc } = service(dir)
    await svc.clean('p', 'node_modules')
    expect(existsSync(join(dir, 'node_modules'))).toBe(false)
    for (const bad of ['src', '../x', '.git', 'package.json', 'node_modules/x', '']) await expect(svc.clean('p', bad), bad).rejects.toThrow()
    expect(existsSync(join(dir, 'src'))).toBe(true)
  })
  it('refuses to delete what git tracks, a symlink, or anything while a script runs, or in an untrusted folder', async () => {
    const dir = project({}, ['dist'])
    await expect(service(dir, { tracked: ['dist'] }).svc.clean('p', 'dist')).rejects.toThrow(/tracks files/)
    await expect(service(dir, { running: true }).svc.clean('p', 'dist')).rejects.toThrow(/script is running/)
    await expect(service(dir, { trusted: false }).svc.clean('p', 'dist')).rejects.toThrow(/Trust/)
    expect(existsSync(join(dir, 'dist'))).toBe(true)
    const outside = project({ 'keep.txt': 'x' })
    symlinkSync(outside, join(dir, 'build'))
    await expect(service(dir).svc.clean('p', 'build')).rejects.toThrow(/not a plain folder/)
    expect(existsSync(join(outside, 'keep.txt'))).toBe(true)
  })
})

describe('the dependency check', () => {
  it('runs npm or pnpm with the right arguments, in the project', async () => {
    const a = service(project({ 'package.json': JSON.stringify({ dependencies: { a: '1' } }), 'package-lock.json': '{}' }))
    const r = await a.svc.report('p')
    expect(a.calls).toEqual(expect.arrayContaining([['npm', 'outdated', '--json'], ['npm', 'audit', '--json']]))
    expect(r.manager).toBe('npm')
    const b = service(project({ 'package.json': '{}', 'pnpm-lock.yaml': '' }))
    await b.svc.report('p')
    expect(b.calls).toEqual(expect.arrayContaining([['pnpm', 'outdated', '--format', 'json'], ['pnpm', 'audit', '--json']]))
  })
  it('says what it cannot do instead of failing: yarn, no package.json, untrusted', async () => {
    expect((await service(project({ 'package.json': '{}', 'yarn.lock': '' })).svc.report('p')).error).toMatch(/npm and pnpm/)
    expect((await service(project({})).svc.report('p')).error).toMatch(/no package.json/)
    await expect(service(project({ 'package.json': '{}' }), { trusted: false }).svc.report('p')).rejects.toThrow(/Trust/)
  })
  it('keeps going when the audit fails but outdated works, and reports a tool that is missing', async () => {
    const r = await service(project({ 'package.json': '{}' }), { runTolerant: async (_f, args) => { if (args[0] === 'audit') throw new Error('offline'); return JSON.stringify({ a: { current: '1.0.0', latest: '2.0.0', wanted: '1.0.0' } }) } }).svc.report('p')
    expect(r.outdated).toHaveLength(1)
    expect(r.vulnError).toBe('offline')
    const gone = await service(project({ 'package.json': '{}' }), { runTolerant: async () => { throw new Error('npm is not installed.') } }).svc.report('p')
    expect(gone.error).toBe('npm is not installed.')
  })
})
