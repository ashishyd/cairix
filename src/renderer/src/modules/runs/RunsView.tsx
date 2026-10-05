import { ChevronDown, ChevronRight, History, Play, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RunRecord } from '@shared/types'
import { formatDuration, summarizeRuns } from '@shared/runs'
import { Button, Chip, Dialog, EmptyState, Segmented } from '@/components/ui'
import { errMsg, timeAgo } from '@/lib/util'
import { findProjectIn, useProjectsStore } from '@/stores/projects-store'
import { useRunsStore } from '@/stores/runs-store'
import { useScriptsStore } from '@/stores/scripts-store'
import { useUiStore } from '@/stores/ui-store'

type Tab = 'runs' | 'scripts'
type StatusFilter = 'all' | 'failed' | 'exited' | 'stopped'
const PAGE = 100

const STATUS: Record<RunRecord['status'], { label: string; tone: 'success' | 'danger' | 'neutral' }> = {
  exited: { label: 'Succeeded', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  stopped: { label: 'Stopped', tone: 'neutral' }
}

/** Only scripts detected from a project can be started again by id. */
const canRerun = (r: RunRecord): boolean => !r.scriptId.startsWith('action:') && !r.scriptId.startsWith('history:')

function Output({ runId }: { runId: string }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    window.cairix.runs.tail(runId).then((t) => live && setText(t), (e) => live && setText(`Could not load output: ${errMsg(e)}`))
    return () => {
      live = false
    }
  }, [runId])
  if (text === null) return <p className="text-cx-faint">Loading…</p>
  return (
    <pre className="selectable max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-cx-border bg-cx-surface p-3 font-mono text-xs">
      {text || 'This run printed nothing.'}
    </pre>
  )
}

function RunRow({ r, open, onToggle }: { r: RunRecord; open: boolean; onToggle: () => void }): React.JSX.Element {
  const workspaces = useProjectsStore((s) => s.workspaces)
  const run = useScriptsStore((s) => s.run)
  const go = useUiStore((s) => s.go)
  const known = !!findProjectIn(workspaces, r.projectId)
  const st = STATUS[r.status]

  async function again(): Promise<void> {
    const started = await run(r.scriptId)
    if (started) go({ kind: 'project', projectId: r.projectId, tab: 'scripts' })
  }

  return (
    <div className="border-b border-cx-border/60 last:border-0">
      <div className="grid items-center gap-3 px-4 hover:bg-cx-hover/40" style={{ gridTemplateColumns: '92px minmax(0,1fr) 96px 80px 88px', paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
        <span><Chip tone={st.tone}>{st.label}{r.status === 'failed' && r.exitCode != null ? ` · ${r.exitCode}` : ''}</Chip></span>
        <button onClick={onToggle} aria-expanded={open} className="min-w-0 text-left">
          <span className="flex items-center gap-1.5">
            {open ? <ChevronDown size={13} className="shrink-0 text-cx-faint" /> : <ChevronRight size={13} className="shrink-0 text-cx-faint" />}
            <span className="truncate font-medium">{r.scriptName}</span>
            <span className="truncate text-cx-muted">{r.projectName}</span>
          </span>
          <span className="mt-0.5 block truncate pl-[19px] font-mono text-xs text-cx-faint" title={r.command}>{r.command}</span>
        </button>
        <span className="text-sm text-cx-muted" title={new Date(r.endedAt).toLocaleString()}>{timeAgo(r.endedAt)}</span>
        <span className="tabular-nums text-cx-muted">{formatDuration(r.durationMs)}</span>
        <span className="flex justify-end">
          {canRerun(r) && <Button size="sm" icon={Play} disabled={!known} title={known ? undefined : 'That project is no longer in Cairix'} onClick={() => void again()}>Run</Button>}
        </span>
      </div>
      {open && <div className="animate-fade bg-cx-surface/70 px-4 py-3 pl-[104px]"><Output runId={r.runId} /></div>}
    </div>
  )
}

/** Every finished script run, kept across restarts, with per-script reliability. */
export function RunsView(): React.JSX.Element {
  const records = useRunsStore((s) => s.records)
  const clear = useRunsStore((s) => s.clear)
  const [tab, setTab] = useState<Tab>('runs')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [project, setProject] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [confirmClear, setConfirmClear] = useState(false)

  const projects = useMemo(() => [...new Map(records.map((r) => [r.projectId, r.projectName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [records])
  const filtered = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    return records.filter((r) => {
      if (status !== 'all' && r.status !== status) return false
      if (project && r.projectId !== project) return false
      const hay = `${r.scriptName} ${r.projectName} ${r.command}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }, [records, query, status, project])
  const stats = useMemo(() => summarizeRuns(filtered), [filtered])

  const finished = filtered.filter((r) => r.status !== 'stopped')
  const failed = finished.filter((r) => r.status === 'failed').length
  const rate = finished.length === 0 ? null : Math.round(((finished.length - failed) / finished.length) * 100)

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Runs</h1>
          <p className="mt-0.5 text-cx-muted">
            {records.length === 0 ? 'Nothing has finished yet' : <>{filtered.length} run{filtered.length === 1 ? '' : 's'}{rate !== null && <> · <span className="font-medium text-cx-text">{rate}%</span> succeeded</>}{failed > 0 && <> · <span className="text-cx-danger">{failed} failed</span></>}</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="no-drag flex h-8 w-52 items-center gap-2 rounded-lg border border-cx-border bg-cx-raised px-2.5 focus-within:border-cx-accent">
            <Search size={14} className="text-cx-faint" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }} placeholder="Filter runs" aria-label="Filter runs" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-cx-faint" />
          </label>
          <select value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project" className="no-drag h-8 max-w-[180px] rounded-lg border border-cx-border bg-cx-raised px-2 outline-none focus:border-cx-accent">
            <option value="">All projects</option>
            {projects.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} aria-label="Status" className="no-drag h-8 rounded-lg border border-cx-border bg-cx-raised px-2 outline-none focus:border-cx-accent">
            <option value="all">Any result</option>
            <option value="failed">Failed</option>
            <option value="exited">Succeeded</option>
            <option value="stopped">Stopped</option>
          </select>
          <Segmented value={tab} onChange={setTab} options={[{ value: 'runs', label: 'History' }, { value: 'scripts', label: 'By script' }]} />
          {records.length > 0 && <Button icon={Trash2} onClick={() => setConfirmClear(true)} aria-label="Clear run history">Clear</Button>}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={History} title={records.length === 0 ? 'No runs yet' : 'Nothing matches those filters'}>
          {records.length === 0 && 'Run a script from a project. When it finishes, its result, duration and output are kept here, even after you quit Cairix.'}
        </EmptyState>
      ) : tab === 'runs' ? (
        <div className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
          <div className="grid gap-3 border-b border-cx-border bg-cx-surface px-4 py-2 cx-label" style={{ gridTemplateColumns: '92px minmax(0,1fr) 96px 80px 88px' }}>
            <span>Result</span><span className="pl-[19px]">Script</span><span>Finished</span><span>Took</span><span />
          </div>
          {filtered.slice(0, shown).map((r) => <RunRow key={r.runId} r={r} open={open === r.runId} onToggle={() => setOpen(open === r.runId ? null : r.runId)} />)}
          {filtered.length > shown && (
            <div className="flex justify-center border-t border-cx-border/60 p-3">
              <Button onClick={() => setShown((n) => n + PAGE)}>Show more ({(filtered.length - shown).toLocaleString()} left)</Button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
          <div className="grid gap-3 border-b border-cx-border bg-cx-surface px-4 py-2 cx-label" style={{ gridTemplateColumns: 'minmax(0,1fr) 64px 150px 90px 96px' }}>
            <span>Script</span><span>Runs</span><span>Success</span><span>Average</span><span>Last run</span>
          </div>
          {stats.map((s) => (
            <div key={s.key} className="grid items-center gap-3 border-b border-cx-border/60 px-4 last:border-0" style={{ gridTemplateColumns: 'minmax(0,1fr) 64px 150px 90px 96px', paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5"><span className="truncate font-medium">{s.scriptName}</span>{s.flaky && <Chip tone="warning" title="2 or more of its last 5 runs failed">flaky</Chip>}</span>
                <span className="block truncate text-sm text-cx-faint">{s.projectName}</span>
              </span>
              <span className="tabular-nums">{s.runs}</span>
              <span>
                <span className="block tabular-nums">{Math.round(s.successRate * 100)}%{s.failures > 0 && <span className="text-cx-faint"> · {s.failures} failed</span>}</span>
                <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-cx-danger/25"><span className="block h-full rounded-full bg-cx-success/80" style={{ width: `${Math.round(s.successRate * 100)}%` }} /></span>
              </span>
              <span className="tabular-nums text-cx-muted">{s.avgMs > 0 ? formatDuration(s.avgMs) : '·'}</span>
              <span className="text-sm text-cx-muted">{timeAgo(s.lastRunAt)}</span>
            </div>
          ))}
        </div>
      )}
      <p className="mt-3 text-sm text-cx-faint">Keeps the last 300 runs and the end of each run's output, with passwords and tokens masked. Stored only on this Mac.</p>

      {confirmClear && (
        <Dialog title="Clear run history?" onClose={() => setConfirmClear(false)} width={440} footer={<><Button onClick={() => setConfirmClear(false)}>Cancel</Button><Button variant="danger" onClick={() => { void clear(); setConfirmClear(false) }}>Clear</Button></>}>
          <p className="text-cx-muted">This removes all {records.length} saved runs and their output. Scripts and projects are not affected.</p>
        </Dialog>
      )}
    </div>
  )
}
