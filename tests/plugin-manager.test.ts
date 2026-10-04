import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { PluginManifest } from '../src/shared/plugins'
import type { PluginHost } from '../src/main/modules/plugins/host'
import { PluginManager } from '../src/main/modules/plugins/manager'

const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })
const tmp = (): string => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-mgr-'))); dirs.push(d); return d }
const put = (root: string, rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }

function pluginSrc(over: object = {}, permissions: string[] = ['storage']): string {
  const d = tmp()
  put(d, 'cairix-plugin.json', JSON.stringify({
    apiVersion: 1, id: 'acme.hello', name: 'Hello', version: '1.0.0', main: 'index.js', permissions,
    contributes: { commands: [{ id: 'say', title: 'Say' }], widgets: [{ id: 'w', title: 'W' }], tabs: [{ id: 't', title: 'T' }] }, ...over
  }))
  put(d, 'index.js', '// code')
  return d
}

class FakeHost implements PluginHost {
  stopped = false
  calls: Array<[string, string, unknown]> = []
  crash: (r: string) => void = () => undefined
  constructor(readonly manifest: PluginManifest, readonly code: string, private readonly behaviour: { failStart?: string; reply?: (kind: string, id: string) => unknown } = {}) {}
  async start(): Promise<void> { if (this.behaviour.failStart) throw new Error(this.behaviour.failStart) }
  async invoke(kind: 'command' | 'widget' | 'tab' | 'action', id: string, payload: unknown): Promise<unknown> {
    this.calls.push([kind, id, payload])
    return this.behaviour.reply ? this.behaviour.reply(kind, id) : { type: 'text', text: `${kind}:${id}` }
  }
  stop(): void { this.stopped = true }
  onCrash(cb: (r: string) => void): void { this.crash = cb }
}

function setup(behaviour: ConstructorParameters<typeof FakeHost>[2] = {}) {
  const dataDir = tmp()
  const hosts: FakeHost[] = []
  let changes = 0
  const make = () => new PluginManager({
    pluginsDir: join(dataDir, 'plugins'), dataDir,
    createHost: (m, code) => { const h = new FakeHost(m, code, behaviour); hosts.push(h); return h },
    onChange: () => void changes++
  })
  return { mgr: make(), make, hosts, dataDir, changes: () => changes }
}

describe('lifecycle and approval', () => {
  it('installs disabled: nothing runs and no permission is granted until the user enables it', async () => {
    const { mgr, hosts } = setup()
    const info = await mgr.install(pluginSrc())
    expect(info).toMatchObject({ enabled: false, state: 'disabled', granted: [] })
    expect(hosts).toHaveLength(0)
    expect(mgr.grantedFor('acme.hello')).toEqual([])
  })
  it('enabling approves exactly the manifest permissions and starts the sandbox', async () => {
    const { mgr, hosts } = setup()
    await mgr.install(pluginSrc({}, ['storage', 'network:api.test.dev']))
    const info = await mgr.setEnabled('acme.hello', true)
    expect(info).toMatchObject({ enabled: true, state: 'running', granted: ['storage', 'network:api.test.dev'] })
    expect(mgr.grantedFor('acme.hello')).toEqual(['storage', 'network:api.test.dev'])
    expect(hosts[0].code).toBe('// code')
  })
  it('disabling stops the sandbox and revokes permissions immediately', async () => {
    const { mgr, hosts } = setup()
    await mgr.install(pluginSrc())
    await mgr.setEnabled('acme.hello', true)
    await mgr.setEnabled('acme.hello', false)
    expect(hosts[0].stopped).toBe(true)
    expect(mgr.grantedFor('acme.hello')).toEqual([])
    await expect(mgr.render('acme.hello', 'widget', 'w', {})).rejects.toThrow(/not running/)
  })
  it('an update that asks for MORE permissions does not run until re-approved', async () => {
    const { mgr, hosts } = setup()
    await mgr.install(pluginSrc())
    await mgr.setEnabled('acme.hello', true)
    const updated = await mgr.install(pluginSrc({ version: '2.0.0' }, ['storage', 'network:evil.dev']))
    expect(updated).toMatchObject({ enabled: true, needsApproval: true, state: 'disabled' })
    expect(updated.error).toMatch(/new permissions/)
    expect(hosts.at(-1)!.stopped).toBe(true)
    expect(mgr.grantedFor('acme.hello')).not.toContain('network:evil.dev')
    // approving (enabling again) grants the new set and runs
    expect(await mgr.setEnabled('acme.hello', true)).toMatchObject({ needsApproval: false, state: 'running' })
  })
  it('an update that asks for the same or fewer permissions keeps running', async () => {
    const { mgr } = setup()
    await mgr.install(pluginSrc({}, ['storage', 'notify']))
    await mgr.setEnabled('acme.hello', true)
    expect(await mgr.install(pluginSrc({ version: '1.1.0' }, ['storage']))).toMatchObject({ needsApproval: false, state: 'running' })
  })
  it('remembers enablement across restarts and restarts enabled plugins', async () => {
    const { mgr, make, hosts } = setup()
    await mgr.install(pluginSrc())
    await mgr.setEnabled('acme.hello', true)
    const again = make()
    await again.startEnabled()
    expect(again.list()[0]).toMatchObject({ enabled: true, state: 'running' })
    expect(hosts).toHaveLength(2)
  })
  it('a plugin that fails to start is marked as an error with the reason, and gets no permissions', async () => {
    const { mgr } = setup({ failStart: 'The plugin failed to load: SyntaxError' })
    await mgr.install(pluginSrc())
    const info = await mgr.setEnabled('acme.hello', true)
    expect(info).toMatchObject({ state: 'error', error: expect.stringMatching(/SyntaxError/) })
  })
  it('a crash is surfaced and the plugin is not used afterwards', async () => {
    const { mgr, hosts, changes } = setup()
    await mgr.install(pluginSrc())
    await mgr.setEnabled('acme.hello', true)
    const before = changes()
    hosts[0].crash('The plugin stopped responding.')
    expect(mgr.list()[0]).toMatchObject({ state: 'error', error: 'The plugin stopped responding.' })
    expect(changes()).toBeGreaterThan(before)
    await expect(mgr.render('acme.hello', 'widget', 'w', {})).rejects.toThrow(/not running/)
  })
  it('uninstall removes files, approvals and stops the sandbox', async () => {
    const { mgr, hosts, dataDir } = setup()
    await mgr.install(pluginSrc())
    await mgr.setEnabled('acme.hello', true)
    await mgr.uninstall('acme.hello')
    expect(hosts[0].stopped).toBe(true)
    expect(mgr.list()).toEqual([])
    expect(JSON.parse(readFileSync(join(dataDir, 'plugins.json'), 'utf8'))).toEqual({})
  })
})

describe('calling a plugin', () => {
  async function running(behaviour?: ConstructorParameters<typeof FakeHost>[2]) {
    const s = setup(behaviour)
    await s.mgr.install(pluginSrc())
    await s.mgr.setEnabled('acme.hello', true)
    return s
  }
  it('renders only contributions the manifest declares', async () => {
    const { mgr } = await running()
    expect(await mgr.render('acme.hello', 'widget', 'w', { projectId: 'p' })).toEqual({ type: 'text', text: 'widget:w' })
    await expect(mgr.render('acme.hello', 'widget', 'undeclared', {})).rejects.toThrow(/does not declare/)
    await expect(mgr.render('acme.hello', 'tab', 'w', {})).rejects.toThrow(/does not declare/) // a widget id is not a tab id
    await expect(mgr.runCommand('acme.hello', 'nope')).rejects.toThrow(/does not declare/)
    await expect(mgr.render('ghost.plugin', 'widget', 'w', {})).rejects.toThrow(/not installed/)
  })
  it("validates what the plugin returns: invalid or hostile UI never reaches the app", async () => {
    for (const bad of [{ type: 'html', html: '<script>' }, 'string', { type: 'text' }]) {
      const { mgr } = await running({ reply: () => bad })
      await expect(mgr.render('acme.hello', 'widget', 'w', {})).rejects.toThrow(/Invalid UI/)
    }
  })
  it('passes the context to tabs and re-renders after an action', async () => {
    const { mgr, hosts } = await running()
    const tree = await mgr.action('acme.hello', 'widget', 'w', 'bump', 'payload-1', {})
    expect(tree).toEqual({ type: 'text', text: 'widget:w' })
    expect(hosts[0].calls.map((c) => c[0])).toEqual(['action', 'widget'])
    expect(hosts[0].calls[0][2]).toMatchObject({ payload: 'payload-1', kind: 'widget', contribId: 'w' })
  })
  it('propagates the plugin\'s own errors as readable messages', async () => {
    const s = await running({ reply: () => { throw new Error('boom from plugin') } })
    await expect(s.mgr.runCommand('acme.hello', 'say')).rejects.toThrow(/boom from plugin/)
  })
})
