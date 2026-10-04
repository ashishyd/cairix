import { join } from 'path'
import { z } from 'zod'
import type { ContributionKind, PluginInfo, PluginManifest, PluginState, RenderContext, UiNode } from '@shared/plugins'
import { readJson, writeJsonAtomic } from '../../json-store'
import type { PluginHost } from './host'
import { installFromFolder, listInstalled, readMain, uninstall, type InstalledPlugin } from './install'
import { validateUi } from './manifest'

const recordSchema = z.record(z.string(), z.object({ enabled: z.boolean(), granted: z.array(z.string()) }))

export interface ManagerDeps {
  pluginsDir: string
  dataDir: string
  createHost(manifest: PluginManifest, code: string): PluginHost
  onChange(): void
  /** Called after a plugin is removed so its stored data and caches can be dropped. */
  onUninstall?(id: string): void
}

/**
 * Owns the lifecycle: install, approve permissions, start/stop each plugin's
 * sandbox, and route render/action/command calls to it. A plugin only runs if
 * the user enabled it AND approved every permission its manifest now asks for,
 * so an update that quietly adds a permission stops until the user re-approves.
 */
export class PluginManager {
  private installed: InstalledPlugin[] = []
  private records: z.infer<typeof recordSchema>
  private hosts = new Map<string, PluginHost>()
  private state = new Map<string, { state: PluginState; error?: string }>()

  constructor(private readonly deps: ManagerDeps) {
    this.records = readJson(join(deps.dataDir, 'plugins.json'), recordSchema, () => ({}))
  }

  async refresh(): Promise<void> {
    this.installed = await listInstalled(this.deps.pluginsDir)
  }

  grantedFor(id: string): string[] {
    const r = this.records[id]
    // Permissions only count while the plugin is enabled and running.
    return r?.enabled && this.state.get(id)?.state !== 'disabled' ? r.granted : []
  }

  private needsApproval(m: PluginManifest): boolean {
    const r = this.records[m.id]
    return !!r?.enabled && !m.permissions.every((p) => r.granted.includes(p))
  }

  list(): PluginInfo[] {
    const out: PluginInfo[] = []
    for (const p of this.installed) {
      if (!p.manifest) continue
      const m = p.manifest
      const r = this.records[m.id]
      const st = this.state.get(m.id)
      out.push({
        manifest: m,
        enabled: !!r?.enabled,
        state: st?.state ?? 'disabled',
        error: st?.error,
        needsApproval: this.needsApproval(m),
        granted: r?.granted ?? []
      })
    }
    return out
  }

  /** Plugins that failed to even load (bad manifest, tampered folder): shown so the user can remove them. */
  broken(): Array<{ folder: string; error: string }> {
    return this.installed.filter((p) => !p.manifest).map((p) => ({ folder: p.folder, error: p.error ?? 'Invalid plugin' }))
  }

  private save(): void {
    writeJsonAtomic(join(this.deps.dataDir, 'plugins.json'), this.records)
  }

  private find(id: string): PluginManifest {
    const m = this.installed.find((p) => p.manifest?.id === id)?.manifest
    if (!m) throw new Error('That plugin is not installed.')
    return m
  }

  async install(srcFolder: string): Promise<PluginInfo> {
    const manifest = await installFromFolder(srcFolder, this.deps.pluginsDir)
    this.stopHost(manifest.id) // an update replaces the running copy
    await this.refresh()
    // A reinstall never keeps old approvals if the new version asks for more.
    this.state.delete(manifest.id)
    if (this.records[manifest.id]?.enabled) await this.start(manifest.id)
    this.deps.onChange()
    return this.list().find((p) => p.manifest.id === manifest.id)!
  }

  /** Enabling is the moment the user approves the manifest's permissions. */
  async setEnabled(id: string, enabled: boolean): Promise<PluginInfo> {
    const m = this.find(id)
    if (enabled) {
      this.records[id] = { enabled: true, granted: [...m.permissions] }
      this.save()
      await this.start(id)
    } else {
      this.records[id] = { enabled: false, granted: this.records[id]?.granted ?? [] }
      this.save()
      this.stopHost(id)
      this.state.set(id, { state: 'disabled' })
    }
    this.deps.onChange()
    return this.list().find((p) => p.manifest.id === id)!
  }

  async uninstall(id: string): Promise<void> {
    this.stopHost(id)
    await uninstall(this.deps.pluginsDir, id)
    delete this.records[id]
    this.state.delete(id)
    this.save()
    this.deps.onUninstall?.(id)
    await this.refresh()
    this.deps.onChange()
  }

  async startEnabled(): Promise<void> {
    await this.refresh()
    for (const p of this.installed) if (p.manifest && this.records[p.manifest.id]?.enabled) await this.start(p.manifest.id)
    this.deps.onChange()
  }

  stopAll(): void {
    for (const id of [...this.hosts.keys()]) this.stopHost(id)
  }

  private async start(id: string): Promise<void> {
    const m = this.find(id)
    if (this.needsApproval(m)) {
      this.state.set(id, { state: 'disabled', error: 'This version asks for new permissions. Enable it again to review and approve them.' })
      return
    }
    this.stopHost(id)
    this.state.set(id, { state: 'starting' })
    try {
      const host = this.deps.createHost(m, await readMain(this.deps.pluginsDir, m))
      host.onCrash((reason) => {
        this.hosts.delete(id)
        this.state.set(id, { state: 'error', error: reason })
        this.deps.onChange()
      })
      this.hosts.set(id, host)
      await host.start()
      this.state.set(id, { state: 'running' })
    } catch (e) {
      this.stopHost(id)
      this.state.set(id, { state: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  private stopHost(id: string): void {
    this.hosts.get(id)?.stop()
    this.hosts.delete(id)
  }

  private host(id: string): PluginHost {
    const h = this.hosts.get(id)
    if (!h || this.state.get(id)?.state !== 'running') throw new Error('That plugin is not running.')
    return h
  }

  private declared(m: PluginManifest, kind: ContributionKind | 'command', id: string): void {
    const list = kind === 'widget' ? m.contributes.widgets : kind === 'tab' ? m.contributes.tabs : m.contributes.commands
    if (!list.some((c) => c.id === id)) throw new Error(`This plugin does not declare a ${kind} called "${id}".`)
  }

  /** Asks the plugin to draw a widget or tab, and validates what comes back before it reaches the UI. */
  async render(id: string, kind: ContributionKind, contribId: string, ctx: RenderContext): Promise<UiNode> {
    const m = this.find(id)
    this.declared(m, kind, contribId)
    const raw = await this.host(id).invoke(kind, contribId, ctx)
    const v = validateUi(raw)
    if (!v.ok) throw new Error(v.error)
    return v.tree
  }

  /** A button or list row was clicked: run the plugin's action, then return the freshly drawn UI. */
  async action(id: string, kind: ContributionKind, contribId: string, action: string, payload: string | undefined, ctx: RenderContext): Promise<UiNode> {
    const m = this.find(id)
    this.declared(m, kind, contribId)
    await this.host(id).invoke('action', action, { payload, kind, contribId, ...ctx })
    return this.render(id, kind, contribId, ctx)
  }

  async runCommand(id: string, commandId: string): Promise<void> {
    const m = this.find(id)
    this.declared(m, 'command', commandId)
    await this.host(id).invoke('command', commandId, null)
  }
}
