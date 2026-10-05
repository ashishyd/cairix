import { ArrowDown, ArrowUp, Archive, CircleCheck, CircleX, Clock, ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, RefreshCw, ShieldAlert, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { GitPrResult, GitState } from '@shared/types'
import { Button, Chip, Dialog, EmptyState } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { useProjectsStore } from '@/stores/projects-store'
import { toast } from '@/stores/toast-store'
import type { ProjectTabProps } from '../registry'

function Card({ title, aside, children, label }: { title: string; aside?: React.ReactNode; children: React.ReactNode; label?: string }): React.JSX.Element {
  return (
    <section aria-label={label ?? title} className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
      <header className="flex items-center justify-between gap-2 border-b border-cx-border bg-cx-surface px-4 py-2">
        <h2 className="cx-label">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  )
}

function PrCard({ result }: { result: GitPrResult }): React.JSX.Element | null {
  if (!result.available) return result.reason ? <p className="text-sm text-cx-faint">{result.reason}</p> : null
  const pr = result.pr
  if (!pr) return <p className="text-sm text-cx-faint">No pull request for this branch yet.</p>
  const { passed, failed, pending } = pr.checks
  return (
    <Card title="Pull request" label="Pull request">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <GitPullRequest size={16} className="shrink-0 text-cx-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium"><span className="text-cx-muted">#{pr.number}</span> {pr.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip tone={pr.state === 'OPEN' ? 'success' : pr.state === 'MERGED' ? 'accent' : 'neutral'}>{pr.isDraft ? 'draft' : pr.state.toLowerCase()}</Chip>
            {failed > 0 && <Chip tone="danger"><CircleX size={10} /> {failed} failing</Chip>}
            {pending > 0 && <Chip tone="warning"><Clock size={10} /> {pending} running</Chip>}
            {passed > 0 && failed === 0 && pending === 0 && <Chip tone="success"><CircleCheck size={10} /> checks passing</Chip>}
            {passed + failed + pending === 0 && <Chip>no checks</Chip>}
            {pr.review && <Chip tone={pr.review === 'APPROVED' ? 'success' : pr.review === 'CHANGES_REQUESTED' ? 'danger' : 'neutral'}>{pr.review.replace('_', ' ').toLowerCase()}</Chip>}
          </p>
        </div>
        <Button size="sm" icon={ExternalLink} onClick={() => void window.cairix.app.openExternal(pr.url).catch((e) => toast.error(errMsg(e)))}>Open</Button>
      </div>
    </Card>
  )
}

/** Everyday git without a terminal: branch, sync, commit, stash, and the pull request for this branch. */
export function GitPanel({ project, workspace }: ProjectTabProps): React.JSX.Element {
  const setTrust = useProjectsStore((s) => s.setTrust)
  const [state, setState] = useState<GitState | null>(null)
  const [pr, setPr] = useState<GitPrResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [all, setAll] = useState(true)
  const [newBranch, setNewBranch] = useState('')
  const [dropping, setDropping] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await window.cairix.git.state(project.id)
      setState(s)
      setError(null)
      void window.cairix.git.pr(project.id).then(setPr, () => setPr(null))
    } catch (e) {
      setError(errMsg(e))
    }
  }, [project.id])

  useEffect(() => {
    setState(null)
    setPr(null)
    if (!project.hasGit) return
    void load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load, project.hasGit])

  async function op(label: string, fn: () => Promise<GitState>, done?: string): Promise<boolean> {
    setBusy(label)
    try {
      setState(await fn())
      setError(null)
      if (done) toast.success(done)
      void window.cairix.git.pr(project.id).then(setPr, () => undefined)
      return true
    } catch (e) {
      toast.error(errMsg(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  if (!project.hasGit) return <div className="h-full overflow-y-auto px-page-x py-5"><EmptyState icon={GitBranch} title="This folder is not a git repository">Run <span className="font-mono">git init</span> in it to track changes.</EmptyState></div>
  if (!workspace.trusted) {
    return (
      <div className="h-full overflow-y-auto px-page-x py-5">
        <EmptyState icon={ShieldAlert} title="Trust this folder to use git from Cairix" action={<Button variant="primary" onClick={() => void setTrust(workspace.id, true)}>Trust folder</Button>}>
          Commits and pushes run your repository's git hooks, which can run any code.
        </EmptyState>
      </div>
    )
  }
  if (!state) return <div className="h-full overflow-y-auto px-page-x py-5">{error ? <p className="rounded-lg bg-cx-danger/10 p-3 text-cx-danger" role="alert">{error}</p> : <p className="text-cx-muted">Reading the repository…</p>}</div>

  const dirty = state.staged + state.changed + state.untracked
  const canCommit = message.trim() !== '' && (all ? dirty > 0 : state.staged > 0) && state.conflicted === 0

  return (
    <div className="h-full space-y-4 overflow-y-auto px-page-x py-5">
      <Card
        title="Branch"
        aside={
          <div className="flex items-center gap-1.5">
            <Button size="sm" icon={RefreshCw} busy={busy === 'fetch'} disabled={!!busy || !state.remote} onClick={() => void op('fetch', () => window.cairix.git.fetch(project.id), 'Fetched')}>Fetch</Button>
            <Button size="sm" icon={ArrowDown} busy={busy === 'pull'} disabled={!!busy || !state.upstream} title={state.upstream ? 'Fast-forward only: never creates a merge' : 'Push this branch first'} onClick={() => void op('pull', () => window.cairix.git.pull(project.id), 'Up to date')}>Pull</Button>
            <Button size="sm" variant="primary" icon={Upload} busy={busy === 'push'} disabled={!!busy || !state.branch || !state.hasCommits} onClick={() => void op('push', () => window.cairix.git.push(project.id), 'Pushed')}>{state.upstream ? 'Push' : 'Publish branch'}</Button>
          </div>
        }
      >
        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <GitBranch size={16} className="text-cx-muted" />
          <span className="font-mono text-base font-semibold" aria-label="Current branch">{state.branch ?? `detached at ${state.detached ?? 'HEAD'}`}</span>
          {state.upstream && <Chip title={`Tracks ${state.upstream}`}>{state.upstream}</Chip>}
          {state.ahead > 0 && <Chip tone="accent" title="Commits not pushed yet"><ArrowUp size={10} /> {state.ahead} ahead</Chip>}
          {state.behind > 0 && <Chip tone="warning" title="Commits on the remote you do not have"><ArrowDown size={10} /> {state.behind} behind</Chip>}
          {state.upstream && state.ahead === 0 && state.behind === 0 && <Chip tone="success">in sync</Chip>}
          {!state.upstream && state.branch && <Chip title="Not on the remote yet">not published</Chip>}
          <span className="ml-auto text-sm text-cx-muted">
            {dirty === 0 ? 'Working tree clean' : [state.staged && `${state.staged} staged`, state.changed && `${state.changed} changed`, state.untracked && `${state.untracked} new`, state.conflicted && `${state.conflicted} conflicted`].filter(Boolean).join(' · ')}
          </span>
        </div>
      </Card>

      {pr && <PrCard result={pr} />}

      <Card title="Commit">
        <div className="space-y-3 p-4">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Describe what changed" aria-label="Commit message" className="no-drag w-full resize-none rounded-lg border border-cx-border bg-cx-surface p-3 outline-none focus:border-cx-accent" />
          <div className="flex items-center justify-between gap-3">
            <label className="no-drag flex items-center gap-2 text-sm text-cx-muted">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-[rgb(var(--cx-accent))]" />
              Include all changes{dirty > 0 ? ` (${state.changed + state.untracked + (all ? state.staged : 0)} files)` : ''}
            </label>
            <div className="flex gap-2">
              <Button icon={Archive} disabled={!!busy || dirty === 0} busy={busy === 'stash'} onClick={() => void op('stash', () => window.cairix.git.stash(project.id, 'push', message.trim() || undefined), 'Changes stashed')}>Stash instead</Button>
              <Button variant="primary" icon={GitCommitHorizontal} busy={busy === 'commit'} disabled={!!busy || !canCommit} onClick={() => void op('commit', () => window.cairix.git.commit(project.id, message, all), 'Committed').then((ok) => ok && setMessage(''))}>Commit</Button>
            </div>
          </div>
          {state.conflicted > 0 && <p className="text-sm text-cx-danger">Resolve the merge conflicts in your editor before committing.</p>}
        </div>
      </Card>

      <Card title={`Branches (${state.branches.length})`} label="Branches" aside={
        <div className="flex items-center gap-1.5">
          <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newBranch && void op('branch', () => window.cairix.git.createBranch(project.id, newBranch), `Switched to ${newBranch}`).then((ok) => ok && setNewBranch(''))} placeholder="new-branch-name" aria-label="New branch name" spellCheck={false} className="no-drag h-6 w-44 rounded-md border border-cx-border bg-cx-raised px-2 font-mono text-xs outline-none focus:border-cx-accent" />
          <Button size="sm" disabled={!newBranch || !!busy} onClick={() => void op('branch', () => window.cairix.git.createBranch(project.id, newBranch), `Switched to ${newBranch}`).then((ok) => ok && setNewBranch(''))}>Create &amp; switch</Button>
        </div>
      }>
        {state.branches.length === 0 ? <p className="px-4 py-3 text-cx-muted">No branches yet. Make a first commit.</p> : state.branches.map((b) => (
          <div key={b.name} className="flex items-center gap-3 border-b border-cx-border/60 px-4 last:border-0" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="truncate font-mono text-sm font-medium">{b.name}</span>
                {b.current && <Chip tone="success">current</Chip>}
                {b.ahead > 0 && <Chip tone="accent">↑{b.ahead}</Chip>}
                {b.behind > 0 && <Chip tone="warning">↓{b.behind}</Chip>}
              </span>
              <span className="block truncate text-sm text-cx-faint">{b.when}{b.subject ? ` · ${b.subject}` : ''}</span>
            </span>
            {!b.current && <Button size="sm" disabled={!!busy} aria-label={`Switch to ${b.name}`} onClick={() => void op('switch', () => window.cairix.git.checkout(project.id, b.name), `Switched to ${b.name}`)}>Switch</Button>}
          </div>
        ))}
      </Card>

      {state.stashes.length > 0 && (
        <Card title={`Stashes (${state.stashes.length})`} label="Stashes">
          {state.stashes.map((s) => (
            <div key={s.index} className="flex items-center gap-3 border-b border-cx-border/60 px-4 py-2 last:border-0">
              <span className="min-w-0 flex-1 truncate text-sm" title={s.message}>{s.message}</span>
              <Button size="sm" disabled={!!busy} aria-label={`Apply stash ${s.index}`} onClick={() => void op('pop', () => window.cairix.git.stash(project.id, 'pop', String(s.index)), 'Stash applied')}>Apply</Button>
              <Button size="sm" variant="ghost" disabled={!!busy} aria-label={`Drop stash ${s.index}`} onClick={() => setDropping(s.index)}>Drop</Button>
            </div>
          ))}
        </Card>
      )}

      {state.recent.length > 0 && (
        <Card title="Recent commits" label="Recent commits">
          {state.recent.map((c) => (
            <div key={c.hash} className="flex items-baseline gap-3 border-b border-cx-border/60 px-4 py-1.5 last:border-0">
              <span className="font-mono text-xs text-cx-faint">{c.hash}</span>
              <span className="min-w-0 flex-1 truncate">{c.subject}</span>
              <span className="shrink-0 text-sm text-cx-faint">{c.author} · {c.when}</span>
            </div>
          ))}
        </Card>
      )}
      {error && <p className="rounded-lg bg-cx-danger/10 p-3 text-cx-danger" role="alert">{error}</p>}

      {dropping !== null && (
        <Dialog title="Drop this stash?" onClose={() => setDropping(null)} width={440} footer={<><Button onClick={() => setDropping(null)}>Cancel</Button><Button variant="danger" onClick={() => { const i = dropping; setDropping(null); void op('drop', () => window.cairix.git.stash(project.id, 'drop', String(i)), 'Stash dropped') }}>Drop</Button></>}>
          <p className="text-cx-muted">The changes saved in it are deleted and cannot be brought back from Cairix.</p>
        </Dialog>
      )}
    </div>
  )
}
