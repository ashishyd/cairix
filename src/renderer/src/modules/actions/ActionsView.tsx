import { AppWindow, Link2, Pencil, Plus, Terminal, Trash2, Zap } from 'lucide-react'
import { useState } from 'react'
import type { ActionDraft, ActionKind, ActionScope, CustomAction } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, IconButton, Segmented, Toggle } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { useActionsStore } from '@/stores/actions-store'
import { toast } from '@/stores/toast-store'

const VARS: Record<ActionScope, string[]> = {
  project: ['project.path', 'project.name', 'branch'],
  port: ['project.path', 'project.name', 'branch', 'port', 'pid', 'url'],
  finding: ['project.path', 'project.name', 'branch', 'file', 'line']
}
const SCOPE_LABEL: Record<ActionScope, string> = { project: 'On a project', port: 'On a port', finding: 'On a finding' }
const KIND_ICON = { shell: Terminal, url: Link2, app: AppWindow }

const EXAMPLES: Array<{ label: string; draft: ActionDraft }> = [
  { label: 'Git status', draft: { name: 'Git status', scope: 'project', kind: 'shell', template: 'git status -sb', confirm: false } },
  { label: 'Install dependencies', draft: { name: 'Install dependencies', scope: 'project', kind: 'shell', template: 'pnpm install', confirm: true } },
  { label: 'Open in iTerm', draft: { name: 'Open in iTerm', scope: 'project', kind: 'app', app: 'iTerm', template: '', confirm: false } },
  { label: 'Open port in Chrome', draft: { name: 'Open in Chrome', scope: 'port', kind: 'shell', template: 'open -a "Google Chrome" {url}', confirm: false } },
  { label: 'Copy port URL', draft: { name: 'Copy URL', scope: 'port', kind: 'shell', template: 'printf %s {url} | pbcopy', confirm: false } },
  { label: 'Open finding in Cursor', draft: { name: 'Open in Cursor at line', scope: 'finding', kind: 'shell', template: 'cursor --goto "{project.path}/{file}:{line}"', confirm: false } }
]

const BLANK: ActionDraft = { name: '', scope: 'project', kind: 'shell', template: '', confirm: false }

function Editor({ initial, onClose }: { initial: ActionDraft; onClose: () => void }): React.JSX.Element {
  const [d, setD] = useState<ActionDraft>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<ActionDraft>): void => {
    setError(null) // a stale message about the previous attempt would be misleading once they edit
    setD((cur) => ({ ...cur, ...p }))
  }

  async function save(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await window.cairix.actions.save(d)
      onClose()
    } catch (e) {
      setError(errMsg(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={d.id ? 'Edit action' : 'New action'}
      onClose={onClose}
      width={600}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>Save</Button>
        </>
      }
    >
      <div className="space-y-4">
        {!d.id && (
          <div>
            <p className="mb-1.5 text-sm text-cx-muted">Start from an example</p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((x) => <button key={x.label} onClick={() => setD(x.draft)} className="no-drag rounded-full border border-cx-border px-2.5 py-0.5 text-sm hover:bg-cx-hover">{x.label}</button>)}
            </div>
          </div>
        )}
        <label className="block">
          <span className="mb-1 block font-medium">Name</span>
          <input value={d.name} onChange={(e) => set({ name: e.target.value })} aria-label="Action name" placeholder="Git status" className="no-drag h-9 w-full rounded-lg border border-cx-border bg-cx-raised px-3 outline-none focus:border-cx-accent" />
        </label>
        <div className="flex flex-wrap gap-6">
          <div>
            <span className="mb-1 block font-medium">Appears</span>
            <Segmented value={d.scope} onChange={(scope) => set({ scope })} options={(Object.keys(SCOPE_LABEL) as ActionScope[]).map((s) => ({ value: s, label: SCOPE_LABEL[s] }))} />
          </div>
          <div>
            <span className="mb-1 block font-medium">Does</span>
            <Segmented value={d.kind} onChange={(kind: ActionKind) => set({ kind })} options={[{ value: 'shell', label: 'Run a command' }, { value: 'url', label: 'Open a link' }, { value: 'app', label: 'Open in an app' }]} />
          </div>
        </div>
        {d.kind === 'app' && (
          <label className="block">
            <span className="mb-1 block font-medium">Application</span>
            <input value={d.app ?? ''} onChange={(e) => set({ app: e.target.value })} aria-label="Application name" placeholder="Cursor" className="no-drag h-9 w-full rounded-lg border border-cx-border bg-cx-raised px-3 outline-none focus:border-cx-accent" />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block font-medium">{d.kind === 'shell' ? 'Command' : d.kind === 'url' ? 'Link' : 'Path to open (blank = the project folder)'}</span>
          <textarea value={d.template} onChange={(e) => set({ template: e.target.value })} aria-label="Action template" rows={3} spellCheck={false} placeholder={d.kind === 'shell' ? 'git -C {project.path} status' : d.kind === 'url' ? 'http://localhost:{port}/admin' : '{project.path}'} className="no-drag w-full resize-none rounded-lg border border-cx-border bg-cx-raised p-3 font-mono text-sm outline-none focus:border-cx-accent" />
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-cx-muted">
            Insert:
            {VARS[d.scope].map((v) => <button key={v} onClick={() => set({ template: `${d.template}{${v}}` })} className="no-drag rounded-md bg-cx-hover px-1.5 py-px font-mono hover:text-cx-text">{`{${v}}`}</button>)}
          </span>
          {d.kind === 'shell' && <span className="mt-1 block text-sm text-cx-faint">Variables are passed safely: a file or branch name can never run as part of the command.</span>}
        </label>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-cx-border px-4 py-3">
          <div>
            <p className="font-medium">Ask before running</p>
            <p className="text-sm text-cx-muted">Shows exactly what will run, with the values filled in.</p>
          </div>
          <Toggle checked={d.confirm} onChange={(confirm) => set({ confirm })} label="Ask before running" />
        </div>
        {error && <p className="text-cx-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

export function ActionsView(): React.JSX.Element {
  const actions = useActionsStore((s) => s.actions)
  const [editing, setEditing] = useState<ActionDraft | null>(null)

  async function remove(a: CustomAction): Promise<void> {
    try {
      await window.cairix.actions.delete(a.id)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  return (
    <div className="mx-auto max-w-[900px] px-page-x py-page-y">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Actions</h1>
          <p className="mt-0.5 text-cx-muted">Your own one-click commands, links and “open in app” shortcuts. They appear under the <Zap size={12} className="inline" /> button on projects, ports and findings.</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={() => setEditing(BLANK)}>New action</Button>
      </div>

      {actions.length === 0 ? (
        <EmptyState icon={Zap} title="No actions yet" action={<Button variant="primary" icon={Plus} onClick={() => setEditing(BLANK)}>Create your first action</Button>}>
          Try “Git status” on projects, “Open in Chrome” on ports, or “Open in Cursor at line” on findings. The editor has examples to start from.
        </EmptyState>
      ) : (
        (Object.keys(SCOPE_LABEL) as ActionScope[]).map((scope) => {
          const list = actions.filter((a) => a.scope === scope)
          return list.length === 0 ? null : (
            <section key={scope} className="mt-6">
              <h2 className="mb-2 cx-label">{SCOPE_LABEL[scope]}</h2>
              <ul className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
                {list.map((a) => {
                  const Icon = KIND_ICON[a.kind]
                  return (
                    <li key={a.id} className="flex items-center gap-3 border-b border-cx-border/60 px-4 py-2.5 last:border-0">
                      <Icon size={15} className="shrink-0 text-cx-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{a.name} {a.confirm && <Chip>asks first</Chip>}</p>
                        <p className="truncate font-mono text-xs text-cx-faint" title={a.template}>{a.kind === 'app' ? `${a.app}: ${a.template}` : a.template}</p>
                      </div>
                      <IconButton icon={Pencil} label={`Edit ${a.name}`} onClick={() => setEditing(a)} />
                      <IconButton icon={Trash2} label={`Delete ${a.name}`} tone="danger" onClick={() => void remove(a)} />
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })
      )}
      {editing && <Editor initial={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
