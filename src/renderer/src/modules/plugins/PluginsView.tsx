import { Plug, Puzzle, ShieldCheck, Trash2, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { describePermission, type PluginInfo } from '@shared/plugins'
import { Button, Chip, Dialog, EmptyState, IconButton } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { usePluginsStore } from '@/stores/plugins-store'
import { toast } from '@/stores/toast-store'

const STATE: Record<PluginInfo['state'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' }> = {
  disabled: { label: 'Off', tone: 'neutral' },
  starting: { label: 'Starting…', tone: 'warning' },
  running: { label: 'Running', tone: 'success' },
  error: { label: 'Error', tone: 'danger' }
}

/** The approval step: shows, in plain words, everything the plugin will be allowed to do. */
function ApproveDialog({ plugin, onClose }: { plugin: PluginInfo; onClose: () => void }): React.JSX.Element {
  const m = plugin.manifest
  const [busy, setBusy] = useState(false)
  const newOnes = plugin.enabled ? m.permissions.filter((p) => !plugin.granted.includes(p)) : []
  async function approve(): Promise<void> {
    setBusy(true)
    try {
      await window.cairix.plugins.setEnabled(m.id, true)
      onClose()
    } catch (e) {
      toast.error(errMsg(e))
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={`Enable ${m.name}?`}
      onClose={onClose}
      width={520}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} icon={ShieldCheck} onClick={() => void approve()}>Allow and enable</Button></>}
    >
      <p className="text-cx-muted">Plugins run in an isolated sandbox. They cannot touch your files or the network except through what you allow here.</p>
      <h3 className="mb-1.5 mt-4 font-medium">{m.permissions.length === 0 ? 'This plugin asks for no permissions' : 'This plugin will be able to:'}</h3>
      <ul className="space-y-1.5">
        {m.permissions.map((p) => (
          <li key={p} className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cx-accent" />
            <span>{describePermission(p)}{newOnes.includes(p) && <> <Chip tone="warning">new</Chip></>}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-cx-faint">{m.name} {m.version}{m.author ? ` by ${m.author}` : ''} · {m.id}</p>
    </Dialog>
  )
}

export function PluginsView(): React.JSX.Element {
  const { plugins, broken } = usePluginsStore()
  const reload = usePluginsStore((s) => s.reload)
  const [approving, setApproving] = useState<PluginInfo | null>(null)
  const [busy, setBusy] = useState(false)

  async function install(): Promise<void> {
    setBusy(true)
    try {
      const info = await window.cairix.plugins.install()
      if (info) {
        await reload()
        toast.success(`Installed ${info.manifest.name}. Review its permissions to enable it.`)
      }
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn()
      await reload()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-page-x py-page-y">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Plugins</h1>
          <p className="mt-0.5 text-cx-muted">Extend Cairix with widgets, project tabs and commands. Each plugin runs sandboxed and only gets the permissions you approve.</p>
        </div>
        <Button variant="primary" icon={Puzzle} busy={busy} onClick={() => void install()}>Install plugin…</Button>
      </div>

      {plugins.length === 0 && broken.length === 0 ? (
        <EmptyState icon={Plug} title="No plugins installed">A plugin is a folder containing <span className="font-mono text-sm">cairix-plugin.json</span> and one JavaScript file. See <span className="font-mono text-sm">docs/PLUGINS.md</span> and the example in <span className="font-mono text-sm">examples/</span>.</EmptyState>
      ) : (
        <ul className="mt-6 space-y-3">
          {plugins.map((p) => {
            const m = p.manifest
            const s = STATE[p.state]
            return (
              <li key={m.id} className="rounded-xl border border-cx-border bg-cx-raised p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold">{m.name}</h2>
                      <span className="text-sm text-cx-faint">{m.version}</span>
                      <Chip tone={s.tone}>{s.label}</Chip>
                      {p.needsApproval && <Chip tone="warning">needs approval</Chip>}
                    </div>
                    {m.description && <p className="mt-0.5 text-cx-muted">{m.description}</p>}
                    <p className="mt-1.5 text-sm text-cx-faint">
                      {[
                        m.contributes.widgets.length > 0 && `${m.contributes.widgets.length} widget${m.contributes.widgets.length === 1 ? '' : 's'}`,
                        m.contributes.tabs.length > 0 && `${m.contributes.tabs.length} tab${m.contributes.tabs.length === 1 ? '' : 's'}`,
                        m.contributes.commands.length > 0 && `${m.contributes.commands.length} command${m.contributes.commands.length === 1 ? '' : 's'}`
                      ].filter(Boolean).join(' · ') || 'No contributions'}
                    </p>
                    {m.permissions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {m.permissions.map((perm) => <Chip key={perm} title={describePermission(perm)}>{perm}</Chip>)}
                      </div>
                    )}
                    {p.error && <p className="mt-2 flex items-start gap-1.5 text-cx-warning"><TriangleAlert size={14} className="mt-0.5 shrink-0" />{p.error}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {p.enabled && !p.needsApproval ? (
                      <Button size="sm" onClick={() => void act(() => window.cairix.plugins.setEnabled(m.id, false))}>Turn off</Button>
                    ) : (
                      <Button size="sm" variant="primary" onClick={() => setApproving(p)}>{p.needsApproval ? 'Review & enable' : 'Enable…'}</Button>
                    )}
                    <IconButton icon={Trash2} label={`Uninstall ${m.name}`} tone="danger" onClick={() => void act(() => window.cairix.plugins.uninstall(m.id))} />
                  </div>
                </div>
              </li>
            )
          })}
          {broken.map((b) => (
            <li key={b.folder} className="rounded-xl border border-cx-danger/30 bg-cx-danger/5 p-4">
              <p className="font-medium text-cx-danger">A plugin could not be loaded</p>
              <p className="text-cx-muted">{b.error}</p>
              <p className="selectable mt-1 truncate font-mono text-xs text-cx-faint">{b.folder}</p>
            </li>
          ))}
        </ul>
      )}
      {approving && <ApproveDialog plugin={approving} onClose={() => { setApproving(null); void reload() }} />}
    </div>
  )
}
