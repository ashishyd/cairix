import { Eye, EyeOff, FilePlus2, KeyRound, Pencil, Plus, ShieldAlert, TriangleAlert, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { EnvFileInfo, EnvSnapshot, EnvVarInfo } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, IconButton, InlineAlert } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { useProjectsStore } from '@/stores/projects-store'
import { toast } from '@/stores/toast-store'
import type { ProjectTabProps } from '../registry'

/** How long a revealed value stays on screen before it hides itself again. */
const REVEAL_MS = 15_000

interface Ctx {
  projectId: string
  apply(p: Promise<EnvSnapshot>): Promise<void>
}

function VarRow({ file, v, ctx }: { file: EnvFileInfo; v: EnvVarInfo; ctx: Ctx }): React.JSX.Element {
  const [shown, setShown] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const editable = file.kind === 'local'

  // Hide a revealed secret again after a while, and when this row goes away.
  useEffect(() => {
    if (shown === null) return
    const t = setTimeout(() => setShown(null), REVEAL_MS)
    return () => clearTimeout(t)
  }, [shown])

  async function reveal(): Promise<string | null> {
    try {
      return await window.cairix.env.reveal(ctx.projectId, file.name, v.key)
    } catch (e) {
      toast.error(errMsg(e))
      return null
    }
  }

  async function toggle(): Promise<void> {
    if (shown !== null) return setShown(null)
    const value = await reveal()
    if (value !== null) setShown(value)
  }

  async function edit(): Promise<void> {
    const value = await reveal()
    if (value !== null) setDraft(value)
  }

  async function save(): Promise<void> {
    if (draft === null) return
    await ctx.apply(window.cairix.env.set(ctx.projectId, file.name, v.key, draft))
    setDraft(null)
  }

  return (
    <div className="flex items-center gap-3 border-b border-cx-border/60 px-4 last:border-0" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
      <span className="flex w-[240px] shrink-0 items-center gap-1.5">
        <span className="selectable truncate font-mono text-sm font-medium" title={v.key}>{v.key}</span>
        {v.sensitive && <KeyRound size={12} className="shrink-0 text-cx-warning" aria-label="Looks like a secret" />}
      </span>
      <span className="min-w-0 flex-1">
        {draft !== null ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => (e.key === 'Enter' ? void save() : e.key === 'Escape' && setDraft(null))}
            aria-label={`Value of ${v.key}`}
            spellCheck={false}
            className="no-drag h-7 w-full rounded-md border border-cx-accent bg-cx-raised px-2 font-mono text-sm outline-none"
          />
        ) : shown !== null ? (
          <span className="selectable block truncate font-mono text-sm" title={shown}>{shown}</span>
        ) : v.empty ? (
          <span className="text-sm italic text-cx-faint">empty</span>
        ) : v.preview !== undefined ? (
          <span className="selectable block truncate font-mono text-sm text-cx-muted" title={v.preview}>{v.preview}</span>
        ) : (
          <span className="font-mono text-sm tracking-widest text-cx-faint" aria-label="Hidden value">{'•'.repeat(Math.min(12, Math.max(4, v.length)))}</span>
        )}
      </span>
      <span className="flex shrink-0 items-center">
        {draft !== null ? (
          <>
            <Button size="sm" variant="primary" onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </>
        ) : (
          <>
            {!v.empty && <IconButton icon={shown !== null ? EyeOff : Eye} label={shown !== null ? `Hide ${v.key}` : `Show ${v.key}`} onClick={() => void toggle()} />}
            {editable && <IconButton icon={Pencil} label={`Edit ${v.key}`} onClick={() => void edit()} />}
            {editable && <IconButton icon={Trash2} tone="danger" label={`Remove ${v.key}`} onClick={() => setConfirmRemove(true)} />}
          </>
        )}
      </span>
      {confirmRemove && (
        <Dialog title={`Remove ${v.key}?`} onClose={() => setConfirmRemove(false)} width={440} footer={<><Button onClick={() => setConfirmRemove(false)}>Cancel</Button><Button variant="danger" onClick={() => { setConfirmRemove(false); void ctx.apply(window.cairix.env.remove(ctx.projectId, file.name, v.key)) }}>Remove</Button></>}>
          <p className="text-cx-muted">This deletes the line from <span className="font-mono">{file.name}</span>. Other lines and comments are left exactly as they are.</p>
        </Dialog>
      )}
    </div>
  )
}

function AddVar({ file, ctx }: { file: EnvFileInfo; ctx: Ctx }): React.JSX.Element {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const exists = file.vars.some((v) => v.key === key)
  async function add(): Promise<void> {
    if (!key) return
    setBusy(true)
    await ctx.apply(window.cairix.env.set(ctx.projectId, file.name, key, value))
    setBusy(false)
    setKey('')
    setValue('')
  }
  return (
    <div className="flex items-center gap-2 border-t border-cx-border bg-cx-surface/60 px-4 py-2">
      <input value={key} onChange={(e) => setKey(e.target.value.toUpperCase())} placeholder="NEW_VARIABLE" aria-label={`New variable name for ${file.name}`} spellCheck={false} className="no-drag h-7 w-[240px] rounded-md border border-cx-border bg-cx-raised px-2 font-mono text-sm outline-none focus:border-cx-accent" />
      <input value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} placeholder="value" aria-label={`New variable value for ${file.name}`} spellCheck={false} className="no-drag h-7 min-w-0 flex-1 rounded-md border border-cx-border bg-cx-raised px-2 font-mono text-sm outline-none focus:border-cx-accent" />
      <Button size="sm" icon={Plus} busy={busy} disabled={!key} onClick={() => void add()}>{exists ? 'Replace' : 'Add'}</Button>
    </div>
  )
}

function FileCard({ file, ctx }: { file: EnvFileInfo; ctx: Ctx }): React.JSX.Element {
  const have = new Set(file.vars.map((v) => v.key))
  const absent = file.missing.filter((k) => !have.has(k))
  const empty = file.missing.filter((k) => have.has(k))
  return (
    <section aria-label={file.name} className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
      <header className="flex flex-wrap items-center gap-2 border-b border-cx-border bg-cx-surface px-4 py-2.5">
        <span className="font-mono text-base font-semibold">{file.name}</span>
        <Chip>{file.kind === 'template' ? 'template' : `${file.vars.length} variable${file.vars.length === 1 ? '' : 's'}`}</Chip>
        {file.kind === 'local' && file.tracked && <Chip tone="danger" title="git tracks this file, so its values are in your repository history"><ShieldAlert size={10} /> committed to git</Chip>}
        {file.kind === 'local' && !file.tracked && file.gitignored === false && <Chip tone="warning" title="Add it to .gitignore before you commit"><TriangleAlert size={10} /> not git-ignored</Chip>}
        {file.kind === 'local' && file.gitignored === true && !file.tracked && <Chip tone="success">git-ignored</Chip>}
      </header>

      {file.template && (absent.length > 0 || empty.length > 0) && (
        <div className="flex items-start gap-3 border-b border-cx-border/60 bg-cx-warning/8 px-4 py-2.5">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-cx-warning" />
          <div className="min-w-0 flex-1 text-sm">
            {absent.length > 0 && <p><span className="font-medium">Missing</span> from {file.name} (in {file.template}): <span className="font-mono">{absent.join(', ')}</span></p>}
            {empty.length > 0 && <p><span className="font-medium">Empty</span> here but set in the template: <span className="font-mono">{empty.join(', ')}</span></p>}
          </div>
          {absent.length > 0 && <Button size="sm" onClick={() => void ctx.apply(window.cairix.env.addMissing(ctx.projectId, file.name))}>Add missing keys</Button>}
        </div>
      )}
      {file.template && file.extra.length > 0 && (
        <p className="border-b border-cx-border/60 px-4 py-2 text-sm text-cx-muted">Not in {file.template}: <span className="font-mono">{file.extra.join(', ')}</span></p>
      )}

      {file.vars.length === 0 ? <p className="px-4 py-3 text-cx-muted">No variables yet.</p> : file.vars.map((v) => <VarRow key={v.key} file={file} v={v} ctx={ctx} />)}
      {file.kind === 'local' && <AddVar file={file} ctx={ctx} />}
    </section>
  )
}

/** A project's .env files: keys at a glance, values on request, and a comparison with .env.example. */
export function EnvPanel({ project, workspace }: ProjectTabProps): React.JSX.Element {
  const setTrust = useProjectsStore((s) => s.setTrust)
  const [snap, setSnap] = useState<EnvSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!workspace.trusted) return
    try {
      setSnap(await window.cairix.env.list(project.id))
      setError(null)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [project.id, workspace.trusted])

  useEffect(() => {
    setSnap(null)
    void load()
    // Files change when you edit them in your editor; refresh on return.
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  const ctx: Ctx = {
    projectId: project.id,
    apply: async (p) => {
      try {
        setSnap(await p)
        setError(null)
      } catch (e) {
        toast.error(errMsg(e))
      }
    }
  }

  if (!workspace.trusted) {
    return (
      <div className="h-full overflow-y-auto px-page-x py-5">
        <EmptyState icon={ShieldAlert} title="Trust this folder to manage its environment files" action={<Button variant="primary" onClick={() => void setTrust(workspace.id, true)}>Trust folder</Button>}>
          Environment files hold secrets, so Cairix only opens them in folders you have trusted.
        </EmptyState>
      </div>
    )
  }

  const hasLocal = snap?.files.some((f) => f.kind === 'local') ?? false
  const template = snap?.files.find((f) => f.kind === 'template')
  const unsafe = snap?.files.filter((f) => f.kind === 'local' && (f.tracked || f.gitignored === false)) ?? []

  return (
    <div className="h-full overflow-y-auto px-page-x py-5">
      {error && <p className="mb-4 rounded-lg bg-cx-danger/10 p-3 text-cx-danger" role="alert">{error}</p>}
      {unsafe.length > 0 && (
        <div className="mb-4">
          <InlineAlert tone="warning">
            {unsafe.map((f) => f.name).join(', ')} {unsafe.some((f) => f.tracked) ? 'is tracked by git or' : 'is'} not covered by .gitignore. Anything secret in {unsafe.length === 1 ? 'it' : 'them'} can end up in your repository.
          </InlineAlert>
        </div>
      )}
      {snap && !hasLocal && template && (
        <div className="mb-4 flex items-center gap-3 rounded-xl border border-cx-border bg-cx-raised px-4 py-3">
          <FilePlus2 size={18} className="shrink-0 text-cx-muted" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">No .env yet</p>
            <p className="text-sm text-cx-muted">Create one from <span className="font-mono">{template.name}</span> and fill in the values.</p>
          </div>
          <Button variant="primary" onClick={() => void ctx.apply(window.cairix.env.create(project.id, '.env', template.name))}>Create .env</Button>
        </div>
      )}
      {snap && snap.files.length === 0 ? (
        <EmptyState icon={KeyRound} title="No environment files here">Add a <span className="font-mono">.env</span> or <span className="font-mono">.env.example</span> to this project and it shows up here.</EmptyState>
      ) : (
        <div className="space-y-4">{snap?.files.map((f) => <FileCard key={f.name} file={f} ctx={ctx} />)}</div>
      )}
      <p className="mt-3 text-sm text-cx-faint">Values stay hidden until you click the eye, and hide again after 15 seconds. Cairix edits only the line you change and keeps comments and order.</p>
    </div>
  )
}
