import { Activity, OctagonX, RefreshCw, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ProcessEntry } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, IconButton, Segmented } from '@/components/ui'
import { errMsg, formatKb, formatUptime } from '@/lib/util'
import { useProcessesStore } from '@/stores/processes-store'
import { toast } from '@/stores/toast-store'

type Filter = 'dev' | 'all'
const COLS = 'minmax(0,1fr) 120px 96px 56px 72px 44px'

/** Confirm-then-stop. Graceful first; if it won't quit, offers a force quit. Main decides what may be stopped. */
function StopDialog({ entry, filter, onClose }: { entry: ProcessEntry; filter: Filter; onClose: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState<'confirm' | 'stopping' | 'stuck'>('confirm')
  const [error, setError] = useState<string | null>(null)
  const refresh = useProcessesStore((s) => s.refresh)

  async function stop(force: boolean): Promise<void> {
    setPhase('stopping')
    setError(null)
    try {
      const r = await window.cairix.processes.stop({ pid: entry.pid, force, filter })
      if (r.ok) {
        toast.success(`Stopped ${entry.framework ?? entry.name}.`)
        void refresh(filter)
        onClose()
      } else if (r.stillAlive.length > 0) setPhase('stuck')
      else {
        setError(r.error ?? 'Could not stop that process.')
        setPhase('confirm')
      }
    } catch (e) {
      setError(errMsg(e))
      setPhase('confirm')
    }
  }

  return (
    <Dialog
      title={phase === 'stuck' ? 'It did not stop' : `Stop ${entry.framework ?? entry.name}?`}
      onClose={onClose}
      width={460}
      footer={
        <>
          <Button onClick={onClose} disabled={phase === 'stopping'}>{phase === 'stuck' ? 'Leave it' : 'Cancel'}</Button>
          {phase === 'stuck' ? (
            <Button variant="danger" icon={OctagonX} onClick={() => void stop(true)}>Force quit</Button>
          ) : (
            <Button variant="danger" busy={phase === 'stopping'} onClick={() => void stop(false)}>Stop</Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-cx-muted">
          {phase === 'stuck'
            ? 'It was asked to quit but is still running after 3 seconds. Force quit ends it immediately, so any unsaved work in it is lost.'
            : <>This ends <span className="font-medium text-cx-text">{entry.name}</span>{entry.procCount > 1 && <> and the {entry.procCount - 1} process{entry.procCount === 2 ? '' : 'es'} it started</>}. It frees about {formatKb(entry.treeRssKb)}.</>}
        </p>
        {entry.category === 'other' && phase !== 'stuck' && (
          <p className="rounded-lg bg-cx-warning/12 p-2.5 text-cx-warning">This doesn't look like a dev tool. Stop it only if you know what it is.</p>
        )}
        <p className="selectable truncate rounded-lg bg-cx-surface px-2.5 py-1.5 font-mono text-xs text-cx-muted" title={entry.cmdline}>pid {entry.pid} · {entry.cmdline}</p>
        {error && <p className="text-cx-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}

function Row({ e, maxKb, onStop }: { e: ProcessEntry; maxKb: number; onStop: () => void }): React.JSX.Element {
  return (
    <div className="grid items-center gap-3 border-b border-cx-border/60 px-4 last:border-0 hover:bg-cx-hover/40" style={{ gridTemplateColumns: COLS, paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium" title={e.cmdline}>{e.name}</span>
          {e.framework && e.framework !== e.name && <Chip tone={e.category === 'database' ? 'warning' : 'accent'}>{e.framework}</Chip>}
          {e.runId && <Chip tone="success" title="Started from Cairix">Cairix</Chip>}
          {e.procCount > 1 && <Chip title="Processes in this group">{e.procCount} procs</Chip>}
        </span>
        <span className="mt-0.5 block truncate text-sm text-cx-faint" title={e.cmdline}>{e.cmdline}</span>
      </span>
      <span className="flex min-w-0 flex-wrap gap-1">
        {e.ports.slice(0, 3).map((p) => <Chip key={p} className="font-mono">:{p}</Chip>)}
        {e.ports.length > 3 && <Chip title={e.ports.slice(3).join(', ')}>+{e.ports.length - 3}</Chip>}
      </span>
      <span>
        <span className="block tabular-nums" title={`This process: ${formatKb(e.rssKb)}`}>{formatKb(e.treeRssKb)}</span>
        <span className="mt-1 block h-[3px] overflow-hidden rounded-full bg-cx-hover">
          <span className="block h-full rounded-full bg-cx-accent/70" style={{ width: `${Math.max(3, Math.round((e.treeRssKb / Math.max(maxKb, 1)) * 100))}%` }} />
        </span>
      </span>
      <span className="tabular-nums text-cx-muted">{e.cpu.toFixed(e.cpu >= 10 ? 0 : 1)}%</span>
      <span className="tabular-nums text-cx-muted">{formatUptime(e.uptimeSec)}</span>
      <span className="flex justify-end">
        <IconButton icon={OctagonX} label={`Stop ${e.name} (pid ${e.pid})`} tone="danger" onClick={onStop} />
      </span>
    </div>
  )
}

/** Machine-wide view of background processes, with a safe way to close them. */
export function ProcessesView(): React.JSX.Element {
  const snapshot = useProcessesStore((s) => s.snapshot)
  const refresh = useProcessesStore((s) => s.refresh)
  const [filter, setFilter] = useState<Filter>('dev')
  const [query, setQuery] = useState('')
  const [stopping, setStopping] = useState<ProcessEntry | null>(null)

  // Poll only while this page is on screen and the window is visible.
  useEffect(() => {
    const sync = (): void => void window.cairix.processes.watch(!document.hidden, filter)
    document.addEventListener('visibilitychange', sync)
    sync()
    void refresh(filter)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      void window.cairix.processes.watch(false, filter)
    }
  }, [filter, refresh])

  // A snapshot for the other filter can still be in flight right after switching.
  const current = snapshot?.filter === filter ? snapshot : null
  const all = current?.entries ?? []
  const visible = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (tokens.length === 0) return all
    return all.filter((e) => {
      const hay = `${e.name} ${e.framework ?? ''} ${e.cmdline} ${e.ports.join(' ')} ${e.pid}`.toLowerCase()
      return tokens.every((t) => hay.includes(t))
    })
  }, [all, query])
  const totalKb = useMemo(() => all.reduce((a, e) => a + e.treeRssKb, 0), [all])
  const maxKb = all.reduce((m, e) => Math.max(m, e.treeRssKb), 0)

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Processes</h1>
          <p className="mt-0.5 text-cx-muted">
            {current ? (
              <>{all.length} running using <span className="font-medium text-cx-text">{formatKb(totalKb)}</span></>
            ) : 'Scanning…'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="no-drag flex h-8 w-56 items-center gap-2 rounded-lg border border-cx-border bg-cx-raised px-2.5 focus-within:border-cx-accent">
            <Search size={14} className="text-cx-faint" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, port or pid" aria-label="Filter processes" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-cx-faint" />
          </label>
          <Segmented value={filter} onChange={setFilter} options={[{ value: 'dev', label: 'Dev & services' }, { value: 'all', label: 'All mine' }]} />
          <IconButton icon={RefreshCw} label="Refresh now" onClick={() => void refresh(filter)} />
        </div>
      </div>

      {current?.error && <p className="mb-4 rounded-lg bg-cx-danger/10 p-3 text-cx-danger" role="alert">Could not list processes: {current.error}</p>}

      {visible.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
          <div className="grid gap-3 border-b border-cx-border bg-cx-surface px-4 py-2 cx-label" style={{ gridTemplateColumns: COLS }}>
            <span>Process</span><span>Ports</span><span>Memory</span><span>CPU</span><span>Up</span><span />
          </div>
          {visible.map((e) => <Row key={e.pid} e={e} maxKb={maxKb} onStop={() => setStopping(e)} />)}
        </div>
      ) : current ? (
        <EmptyState
          icon={Activity}
          title={query ? 'Nothing matches that filter' : filter === 'dev' ? 'No background dev processes' : 'Nothing to show'}
          action={filter === 'dev' && !query ? <Button onClick={() => setFilter('all')}>Show all my processes</Button> : undefined}
        >
          {filter === 'dev' && !query && 'Dev servers, watchers, databases and language servers that are running in the background appear here.'}
        </EmptyState>
      ) : null}

      <p className="mt-3 text-sm text-cx-faint">Only your own processes are listed. macOS services, installed apps, shells and Cairix itself are never shown or stopped.</p>
      {stopping && <StopDialog entry={stopping} filter={filter} onClose={() => setStopping(null)} />}
    </div>
  )
}
