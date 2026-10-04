import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { Broker, hostAllowed, PermissionError, type BrokerDeps } from '../src/main/modules/plugins/broker'
import { installFromFolder, InstallError, listInstalled, MAX_FILES, readMain, uninstall } from '../src/main/modules/plugins/install'

const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })
const tmp = (): string => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-plg-'))); dirs.push(d); return d }
const put = (root: string, rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }

function broker(granted: string[], over: Partial<BrokerDeps> = {}) {
  const notes: string[] = []
  const opened: string[] = []
  const b = new Broker({
    grantedFor: () => granted,
    projects: () => [{ id: 'p', name: 'web', path: '/x', kinds: ['node'] }],
    ports: () => [{ port: 3000, name: 'node', memoryKb: 1, category: 'dev' }],
    agents: () => [{ title: 't', kind: 'claude', status: 'busy' }],
    dataDir: tmp(),
    notify: (_p, m) => void notes.push(m),
    openUrl: async (u) => void opened.push(u),
    ...over
  })
  return { b, notes, opened }
}

describe('permissions', () => {
  it.each([
    ['projects.list', 'projects.read'], ['ports.list', 'ports.read'], ['agents.list', 'agents.read'],
    ['storage.get', 'storage'], ['storage.keys', 'storage']
  ])('%s is denied without %s and allowed with it', async (method, perm) => {
    const args = method.startsWith('storage') ? { key: 'k' } : {}
    await expect(broker([]).b.handle('a.b', method, args)).rejects.toBeInstanceOf(PermissionError)
    await expect(broker([]).b.handle('a.b', method, args)).rejects.toThrow(new RegExp(perm))
    await expect(broker([perm]).b.handle('a.b', method, args)).resolves.toBeDefined()
  })
  it('only grants what was granted, not what was asked for', async () => {
    const { b } = broker(['ports.read'])
    await expect(b.handle('a.b', 'ports.list', {})).resolves.toHaveLength(1)
    await expect(b.handle('a.b', 'projects.list', {})).rejects.toThrow(/projects\.read/)
  })
  it('rejects unknown methods rather than guessing', async () => {
    await expect(broker(['storage']).b.handle('a.b', 'fs.readFile', { path: '/etc/passwd' })).rejects.toThrow(/Unknown method/)
    await expect(broker(['storage']).b.handle('a.b', '__proto__', {})).rejects.toThrow(/Unknown method/)
  })
  it('notify and openUrl need their permission and validate input', async () => {
    const n = broker([])
    await expect(n.b.handle('a.b', 'ui.notify', { message: 'hi' })).rejects.toThrow(/notify/)
    const ok = broker(['notify', 'openUrl'])
    await ok.b.handle('a.b', 'ui.notify', { message: 'hi' })
    expect(ok.notes).toEqual(['hi'])
    await expect(ok.b.handle('a.b', 'ui.notify', { message: 'x'.repeat(201) })).rejects.toThrow()
    await ok.b.handle('a.b', 'ui.openUrl', { url: 'https://example.com/docs' })
    expect(ok.opened).toEqual(['https://example.com/docs'])
    for (const url of ['http://example.com', 'file:///etc/passwd', 'javascript:alert(1)']) await expect(ok.b.handle('a.b', 'ui.openUrl', { url })).rejects.toThrow()
    expect(ok.opened).toHaveLength(1)
  })
})

describe('storage', () => {
  it('is private per plugin, persists, and enforces limits', async () => {
    const dataDir = tmp()
    const g = ['storage']
    const b1 = new Broker({ ...broker(g).b['deps'], dataDir, grantedFor: () => g })
    await b1.handle('one.a', 'storage.set', { key: 'n', value: { count: 2 } })
    expect(await b1.handle('one.a', 'storage.get', { key: 'n' })).toEqual({ count: 2 })
    expect(await b1.handle('two.b', 'storage.get', { key: 'n' })).toBeNull() // another plugin cannot see it
    expect(await new Broker({ ...b1['deps'] }).handle('one.a', 'storage.get', { key: 'n' })).toEqual({ count: 2 }) // survives restart
    await expect(b1.handle('one.a', 'storage.set', { key: 'big', value: 'x'.repeat(300_000) })).rejects.toThrow(/too large/)
    for (const k of ['../escape', 'a/b', '', 'x'.repeat(81)]) await expect(b1.handle('one.a', 'storage.set', { key: k, value: 1 })).rejects.toThrow()
    await b1.handle('one.a', 'storage.delete', { key: 'n' })
    expect(await b1.handle('one.a', 'storage.keys', {})).toEqual([])
    expect(readFileSync(join(dataDir, 'plugin-data', 'one.a.json'), 'utf8')).toBe('{}')
  })
  it('purge deletes a removed plugin\'s data from disk', async () => {
    const dataDir = tmp()
    const b = new Broker({ ...broker(['storage']).b['deps'], dataDir, grantedFor: () => ['storage'] })
    await b.handle('one.a', 'storage.set', { key: 'k', value: 1 })
    const { existsSync } = await import('fs')
    expect(existsSync(join(dataDir, 'plugin-data', 'one.a.json'))).toBe(true)
    b.purge('one.a')
    expect(existsSync(join(dataDir, 'plugin-data', 'one.a.json'))).toBe(false)
    expect(await b.handle('one.a', 'storage.get', { key: 'k' })).toBeNull()
  })
  it('refuses to grow past 1 MB total', async () => {
    const { b } = broker(['storage'])
    for (let i = 0; i < 4; i++) await b.handle('a.b', 'storage.set', { key: `k${i}`, value: 'x'.repeat(240_000) })
    await expect(b.handle('a.b', 'storage.set', { key: 'k5', value: 'x'.repeat(240_000) })).rejects.toThrow(/full/)
  })
})

describe('network', () => {
  it.each([
    ['api.github.com', ['network:api.github.com'], true],
    ['API.GITHUB.COM', ['network:api.github.com'], true],
    ['evil.api.github.com', ['network:api.github.com'], false],
    ['github.com', ['network:api.github.com'], false],
    ['a.example.com', ['network:*.example.com'], true],
    ['example.com', ['network:*.example.com'], false],
    ['badexample.com', ['network:*.example.com'], false],
    ['example.com.evil.io', ['network:*.example.com'], false],
    ['x.com', [], false]
  ])('host %s with %j -> %s', (host, perms, ok) => expect(hostAllowed(host, perms)).toBe(ok))

  const reply = (body = 'ok', init: ResponseInit = {}) => new Response(body, init)

  it('fetches an allowed https host and returns text and status', async () => {
    const calls: string[] = []
    const { b } = broker(['network:api.test.dev'], { fetchImpl: (async (u: URL) => (calls.push(String(u)), reply('{"a":1}', { headers: { 'content-type': 'application/json' } }))) as never })
    expect(await b.handle('a.b', 'http.fetch', { url: 'https://api.test.dev/x?y=1' })).toMatchObject({ status: 200, ok: true, text: '{"a":1}', contentType: 'application/json' })
    expect(calls).toEqual(['https://api.test.dev/x?y=1'])
  })
  it('refuses hosts it was not granted, plain http, and malformed urls, without making a request', async () => {
    let called = 0
    const { b } = broker(['network:api.test.dev'], { fetchImpl: (async () => (called++, reply())) as never })
    await expect(b.handle('a.b', 'http.fetch', { url: 'https://other.dev/' })).rejects.toThrow(/not allowed to contact other\.dev/)
    await expect(b.handle('a.b', 'http.fetch', { url: 'http://api.test.dev/' })).rejects.toThrow(/https/)
    await expect(b.handle('a.b', 'http.fetch', { url: 'https://127.0.0.1/' })).rejects.toThrow(/not allowed/)
    await expect(b.handle('a.b', 'http.fetch', { url: 'file:///etc/passwd' })).rejects.toThrow(/https/)
    await expect(b.handle('a.b', 'http.fetch', { url: 'nonsense' })).rejects.toThrow(/valid URL/)
    expect(called).toBe(0)
  })
  it('re-checks every redirect hop: an allowed host cannot bounce the request to a forbidden one', async () => {
    const seen: string[] = []
    const { b } = broker(['network:api.test.dev'], {
      fetchImpl: (async (u: URL) => {
        seen.push(u.hostname)
        return u.hostname === 'api.test.dev' ? new Response(null, { status: 302, headers: { location: 'https://internal.corp/secret' } }) : reply('SECRET')
      }) as never
    })
    await expect(b.handle('a.b', 'http.fetch', { url: 'https://api.test.dev/' })).rejects.toThrow(/internal\.corp/)
    expect(seen).toEqual(['api.test.dev']) // the forbidden hop was never requested
  })
  it('follows redirects between allowed hosts, but not forever', async () => {
    let n = 0
    const loop = broker(['network:api.test.dev'], { fetchImpl: (async () => (n++, new Response(null, { status: 302, headers: { location: 'https://api.test.dev/next' } }))) as never })
    await expect(loop.b.handle('a.b', 'http.fetch', { url: 'https://api.test.dev/' })).rejects.toThrow(/redirects/)
    expect(n).toBe(4)
  })
  it('strips cookies and other forbidden headers, never sends credentials, and omits a body on GET', async () => {
    let init: RequestInit | undefined
    const { b } = broker(['network:api.test.dev'], { fetchImpl: (async (_u: URL, i: RequestInit) => ((init = i), reply())) as never })
    await b.handle('a.b', 'http.fetch', { url: 'https://api.test.dev/', headers: { Cookie: 'sid=1', Host: 'evil', 'Sec-Fetch-Mode': 'x', Authorization: 'Bearer t', 'X-Thing': '1' }, body: 'ignored' })
    expect(init!.headers).toEqual({ Authorization: 'Bearer t', 'X-Thing': '1' })
    expect(init!.body).toBeUndefined()
    expect(init!.credentials).toBe('omit')
    expect(init!.redirect).toBe('manual')
  })
  it('caps the response size', async () => {
    const { b } = broker(['network:api.test.dev'], { fetchImpl: (async () => reply('x'.repeat(1_100_000))) as never })
    await expect(b.handle('a.b', 'http.fetch', { url: 'https://api.test.dev/' })).rejects.toThrow(/too large/)
  })
  it('network permission is per host: having storage or another host grants nothing', async () => {
    const { b } = broker(['storage', 'network:a.dev'], { fetchImpl: (async () => reply()) as never })
    await expect(b.handle('a.b', 'http.fetch', { url: 'https://b.dev/' })).rejects.toBeInstanceOf(PermissionError)
  })
})

describe('installing a plugin folder (treated as hostile)', () => {
  const manifest = (over: object = {}) => JSON.stringify({ apiVersion: 1, id: 'acme.hello', name: 'Hello', version: '1.0.0', main: 'index.js', permissions: ['storage'], ...over })
  function plugin(files: Record<string, string> = {}): string {
    const d = tmp()
    put(d, 'cairix-plugin.json', manifest())
    put(d, 'index.js', 'cairix.plugin.register({})')
    for (const [k, v] of Object.entries(files)) put(d, k, v)
    return d
  }

  it('copies a valid plugin into a folder named after its id', async () => {
    const dest = tmp()
    const m = await installFromFolder(plugin({ 'lib/util.js': '1' }), dest)
    expect(m.id).toBe('acme.hello')
    expect(await readMain(dest, m)).toContain('register')
    expect((await listInstalled(dest)).map((p) => p.manifest?.id)).toEqual(['acme.hello'])
  })
  it('replaces an older copy on update', async () => {
    const dest = tmp()
    await installFromFolder(plugin(), dest)
    const v2 = plugin({ 'cairix-plugin.json': manifest({ version: '2.0.0' }), 'extra.js': 'x' })
    expect((await installFromFolder(v2, dest)).version).toBe('2.0.0')
    expect((await listInstalled(dest))[0].manifest?.version).toBe('2.0.0')
  })
  it('rejects symlinks, which could expose your own files to the plugin', async () => {
    const src = plugin()
    symlinkSync('/etc/passwd', join(src, 'stolen.js'))
    await expect(installFromFolder(src, tmp())).rejects.toThrow(/symbolic link/)
    const src2 = plugin()
    symlinkSync(tmp(), join(src2, 'dir'))
    await expect(installFromFolder(src2, tmp())).rejects.toBeInstanceOf(InstallError)
  })
  it('rejects a missing/invalid manifest, a missing or oversize main file, too many files and oversize plugins', async () => {
    const empty = tmp()
    await expect(installFromFolder(empty, tmp())).rejects.toThrow(/cairix-plugin\.json/)
    const noMain = tmp(); put(noMain, 'cairix-plugin.json', manifest())
    await expect(installFromFolder(noMain, tmp())).rejects.toThrow(/main file/)
    await expect(installFromFolder(plugin({ 'index.js': 'x'.repeat(500_001) }), tmp())).rejects.toThrow(/500 KB/)
    const many: Record<string, string> = {}
    for (let i = 0; i <= MAX_FILES; i++) many[`f${i}.txt`] = '1'
    await expect(installFromFolder(plugin(many), tmp())).rejects.toThrow(/more than/)
    await expect(installFromFolder(plugin({ 'big.bin': 'x'.repeat(5_000_001) }), tmp())).rejects.toThrow(/5 MB/)
    await expect(installFromFolder(join(tmp(), 'nope'), tmp())).rejects.toThrow(/not a folder/)
  })
  it('refuses path-traversing ids and mains before touching the disk', async () => {
    for (const bad of [{ id: '../../evil.x' }, { main: '../../outside.js' }, { main: '/etc/passwd.js' }]) {
      const dest = tmp()
      await expect(installFromFolder(plugin({ 'cairix-plugin.json': manifest(bad) }), dest)).rejects.toThrow()
      expect((await listInstalled(dest))).toEqual([])
    }
  })
  it('skips node_modules and .git, and cleans up after a failure', async () => {
    const dest = tmp()
    await installFromFolder(plugin({ 'node_modules/x/i.js': '1', '.git/HEAD': 'x' }), dest)
    const { readdirSync } = await import('fs')
    expect(readdirSync(join(dest, 'acme.hello')).sort()).toEqual(['cairix-plugin.json', 'index.js'])
    const failing = plugin(); symlinkSync('/etc', join(failing, 'l'))
    await expect(installFromFolder(failing, dest)).rejects.toThrow()
    expect(readdirSync(dest).filter((n) => n.startsWith('.installing'))).toEqual([])
  })
  it('a tampered folder whose name does not match its manifest id is flagged, not trusted', async () => {
    const dest = tmp()
    put(dest, 'acme.other/cairix-plugin.json', manifest()) // manifest says acme.hello
    put(dest, 'acme.other/index.js', '1')
    const [p] = await listInstalled(dest)
    expect(p.manifest).toBeUndefined()
    expect(p.error).toMatch(/does not match/)
  })
  it('uninstall only accepts a well-formed id (no path traversal)', async () => {
    const dest = tmp(); const victim = tmp(); put(victim, 'keep.txt', 'x')
    await expect(uninstall(dest, '../' + victim.split('/').pop())).rejects.toBeInstanceOf(InstallError)
    await installFromFolder(plugin(), dest)
    await uninstall(dest, 'acme.hello')
    expect(await listInstalled(dest)).toEqual([])
    expect(readFileSync(join(victim, 'keep.txt'), 'utf8')).toBe('x')
  })
})
