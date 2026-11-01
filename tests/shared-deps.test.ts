import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, chmodSync } from 'fs'
import { join } from 'path'
import { mergeInto, pruneStore } from '../src/main/modules/shared-deps/link'
import { scanNodeModules } from '../src/main/modules/shared-deps/scan'
import { SharedDepsService } from '../src/main/modules/shared-deps/service'
import { json, link, makeTree } from './helpers'

const cleanups: Array<() => void> = []
afterEach(() => cleanups.splice(0).forEach((c) => c()))

const big = 'x'.repeat(40_000)
const pkg = (name: string, version: string, extra: Record<string, string> = {}): Record<string, string> => ({
  [`node_modules/${name}/package.json`]: json({ name, version }),
  [`node_modules/${name}/index.js`]: big,
  ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [`node_modules/${name}/${k}`, v]))
})
const prefixed = (dir: string, files: Record<string, string>): Record<string, string> => Object.fromEntries(Object.entries(files).map(([k, v]) => [`${dir}/${k}`, v]))

function setup(files: Record<string, string>): string {
  const t = makeTree(files)
  cleanups.push(t.cleanup)
  return t.root
}

describe('scanning node_modules', () => {
  it('finds plain, scoped and nested packages and skips symlinks, dot folders and aliases', async () => {
    const root = setup({
      ...pkg('left-pad', '1.3.0'),
      'node_modules/@scope/thing/package.json': json({ name: '@scope/thing', version: '2.0.0' }),
      'node_modules/left-pad/node_modules/inner/package.json': json({ name: 'inner', version: '0.1.0' }),
      'node_modules/aliased/package.json': json({ name: 'something-else', version: '1.0.0' }),
      'node_modules/.bin/tool': 'x',
      'real/pkg/package.json': json({ name: 'linked', version: '1.0.0' })
    })
    link(join(root, 'real/pkg'), join(root, 'node_modules/linked'))
    const found = await scanNodeModules(join(root, 'node_modules'), new Set())
    expect(found.map((f) => `${f.name}@${f.version}`).sort()).toEqual(['@scope/thing@2.0.0', 'inner@0.1.0', 'left-pad@1.3.0'])
    expect(found.find((f) => f.name === 'left-pad')!.bytes).toBeGreaterThan(30_000)
  })

  it('rejects names and versions that could escape the store', async () => {
    const root = setup({
      'node_modules/..evil/package.json': json({ name: '..evil', version: '1.0.0' }),
      'node_modules/ok/package.json': json({ name: 'ok', version: '../../x' })
    })
    expect(await scanNodeModules(join(root, 'node_modules'), new Set())).toEqual([])
  })

  it('counts a hard-linked file once', async () => {
    const root = setup({ ...prefixed('a', pkg('dup', '1.0.0')) })
    mkdirSync(join(root, 'b/node_modules/dup'), { recursive: true })
    for (const f of ['package.json', 'index.js']) linkSync(join(root, 'a/node_modules/dup', f), join(root, 'b/node_modules/dup', f))
    const seen = new Set<string>()
    const a = await scanNodeModules(join(root, 'a/node_modules'), seen)
    const b = await scanNodeModules(join(root, 'b/node_modules'), seen)
    expect(a[0].bytes).toBeGreaterThan(0)
    expect(b[0].bytes).toBe(0)
  })
})

describe('mergeInto', () => {
  it('hard-links identical files, leaves different and mode-different ones, and keeps the folder intact', async () => {
    const root = setup({
      ...prefixed('canon', { 'package.json': '{"v":1}', 'same.js': big, 'diff.node': 'AAAA', 'exec.sh': 'echo' }),
      ...prefixed('copy', { 'package.json': '{"v":1}', 'same.js': big, 'diff.node': 'BBBB', 'exec.sh': 'echo', 'extra.js': 'only here' })
    })
    chmodSync(join(root, 'copy/exec.sh'), 0o755)
    const r = await mergeInto(join(root, 'canon'), join(root, 'copy'))
    expect(r.linkedFiles).toBe(2)
    expect(r.skippedFiles).toBe(3) // diff.node, exec.sh (mode), extra.js (no counterpart)
    expect(lstatSync(join(root, 'copy/same.js')).ino).toBe(lstatSync(join(root, 'canon/same.js')).ino)
    expect(lstatSync(join(root, 'copy/diff.node')).ino).not.toBe(lstatSync(join(root, 'canon/diff.node')).ino)
    expect(readFileSync(join(root, 'copy/diff.node'), 'utf8')).toBe('BBBB')
    expect(existsSync(join(root, 'copy/same.js.cairix-tmp'))).toBe(false)
    expect(lstatSync(join(root, 'copy/same.js')).isSymbolicLink()).toBe(false)
  })

  it('is idempotent and reports nothing saved the second time', async () => {
    const root = setup({ ...prefixed('canon', { 'a.js': big }), ...prefixed('copy', { 'a.js': big }) })
    const first = await mergeInto(join(root, 'canon'), join(root, 'copy'))
    const second = await mergeInto(join(root, 'canon'), join(root, 'copy'))
    expect(first.linkedFiles).toBe(1)
    expect(first.savedBytes).toBeGreaterThan(0)
    expect(second).toEqual({ linkedFiles: 0, savedBytes: 0, skippedFiles: 0 })
  })
})

describe('SharedDepsService', () => {
  function build(trusted = { a: true, b: true, c: true }, running = new Set<string>()) {
    const root = setup({
      ...prefixed('a', { ...pkg('react', '19.0.0'), ...pkg('only-a', '1.0.0') }),
      ...prefixed('b', { ...pkg('react', '19.0.0'), ...pkg('react-dom', '19.0.0') }),
      ...prefixed('c', { ...pkg('react', '18.0.0'), ...pkg('react-dom', '19.0.0') })
    })
    const svc = new SharedDepsService({
      storeDir: join(root, 'store'),
      projects: () => (['a', 'b', 'c'] as const).map((id) => ({ id, name: id, path: join(root, id), trusted: trusted[id] })),
      isRunning: (id) => running.has(id)
    })
    return { root, svc }
  }

  it('groups only same name and version across projects, sorted by what they would free', async () => {
    const { svc } = build()
    const r = await svc.scan()
    expect(r.groups.map((g) => g.key).sort()).toEqual(['react-dom@19.0.0', 'react@19.0.0'])
    expect(r.projects).toBe(3)
    const react = r.groups.find((g) => g.key === 'react@19.0.0')!
    expect(react.copies).toHaveLength(2)
    expect(react.reclaimableKb).toBeGreaterThan(30)
  })

  it('shares the chosen packages, frees space, and a rescan shows nothing left', async () => {
    const { root, svc } = build()
    const before = await svc.scan()
    const r = await svc.apply(['react@19.0.0'])
    expect(r.applied[0].key).toBe('react@19.0.0')
    expect(r.applied[0].savedKb).toBeGreaterThan(30)
    expect(r.report.groups.map((g) => g.key)).toEqual(['react-dom@19.0.0'])
    expect(r.report.reclaimableKb).toBeLessThan(before.reclaimableKb)
    expect(lstatSync(join(root, 'a/node_modules/react/index.js')).ino).toBe(lstatSync(join(root, 'b/node_modules/react/index.js')).ino)
    expect(lstatSync(join(root, 'store/react@19.0.0/index.js')).ino).toBe(lstatSync(join(root, 'a/node_modules/react/index.js')).ino)
    expect(realpathSync(join(root, 'b/node_modules/react'))).toBe(join(root, 'b/node_modules/react')) // still a real folder
  })

  it('skips copies in untrusted or running projects instead of touching them', async () => {
    const { root, svc } = build({ a: true, b: false, c: true })
    await svc.scan()
    const r = await svc.apply(['react@19.0.0'])
    expect(r.applied).toEqual([])
    expect(r.skipped[0].key).toBe('react@19.0.0')
    expect(lstatSync(join(root, 'a/node_modules/react/index.js')).nlink).toBe(1)

    const running = build(undefined, new Set(['b']))
    await running.svc.scan()
    expect((await running.svc.apply(['react@19.0.0'])).skipped).toHaveLength(1)
  })

  it('ignores keys that were not in the last scan', async () => {
    const { svc } = build()
    await svc.scan()
    const r = await svc.apply(['evil@1.0.0', '../../etc@1.0.0'])
    expect(r.applied).toEqual([])
    expect(r.skipped).toHaveLength(2)
  })

  it('prunes store entries no project uses, keeps the ones still shared', async () => {
    const { root, svc } = build()
    await svc.scan()
    await svc.apply(['react@19.0.0', 'react-dom@19.0.0'])
    rmSync(join(root, 'a/node_modules/react'), { recursive: true })
    rmSync(join(root, 'b/node_modules/react'), { recursive: true })
    const r = await svc.prune()
    expect(r.removed).toBe(1)
    expect(existsSync(join(root, 'store/react@19.0.0'))).toBe(false)
    expect(existsSync(join(root, 'store/react-dom@19.0.0'))).toBe(true)
    expect((await pruneStore(join(root, 'store'))).removed).toBe(0)
  })
})
