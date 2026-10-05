import { Ban, Copy, FolderOpen, Play, Search, SquareTerminal, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { HistoryEntry, HistoryRule } from '@shared/types'
import { Button, Chip, Dialog, EmptyState, IconButton, Segmented } from '@/components/ui'
import { errMsg, timeAgo } from '@/lib/util'
import { projectLabel, useProjectsStore } from '@/stores/projects-store'
import { useHistoryStore } from '@/stores/history-store'
import { toast } from '@/stores/toast-store'

type Sort = 'count' | 'recent' | 'alpha'

const SORTS: Record<Sort, (a: HistoryEntry, b: HistoryEntry) => number> = {
  // Most run first; ties go to the more recent, then alphabetical so the order is stable.
  count: (a, b) => b.count - a.count || b.lastRun - a.lastRun || a.command.localeCompare(b.command),
  recent: (a, b) => b.lastRun - a.lastRun || b.count - a.count,
  alpha: (a, b) => a.command.localeCompare(b.command)
}

/** Every whitespace-separated word must appear in the command, its program or its description. */
export function matchesQuery(e: HistoryEntry, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return true
  const hay = `${e.command} ${e.description}`.toLowerCase()
  return tokens.every((t) => hay.includes(t))
}

const PAGE = 100
const DAY = 86_400_000

/** "5m ago" for recent commands, a calendar date once it is more than two months old. */
const lastRunLabel = (ms: number): string => (Date.now() - ms > 60 * DAY ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : timeAgo(ms))

function NeverTrackDialog({ entry, onClose }: { entry: HistoryEntry; onClose: () => void }): React.JSX.Element {
  const ignore = useHistoryStore((s) => s.ignore)
  const choose = async (rule: HistoryRule): Promise<void> => {
    await ignore(rule)
    toast.success(rule.kind === 'program' ? `Cairix will no longer track ${rule.value} commands.` : 'Cairix will no longer track that command.')
    onClose()
  }
  return (
    <Dialog title="Never track…" onClose={onClose} width={500} footer={<Button onClick={onClose}>Cancel</Button>}>
      <p className="selectable mb-3 truncate rounded-lg bg-cx-surface px-2.5 py-1.5 font-mono text-sm" title={entry.command}>{entry.command}</p>
      <div className="space-y-2">
        <button onClick={() => void choose({ kind: 'command', value: entry.command })} className="no-drag w-full rounded-xl border border-cx-border px-4 py-3 text-left hover:bg-cx-hover">
          <span className="block font-medium">Just this command</span>
          <span className="text-sm text-cx-muted">Other {entry.program ? <span className="font-mono">{entry.program}</span> : 'commands'} commands are still tracked.</span>
        </button>
        {entry.program && (
          <button onClick={() => void choose({ kind: 'program', value: entry.program })} className="no-drag w-full rounded-xl border border-cx-border px-4 py-3 text-left hover:bg-cx-hover">
            <span className="block font-medium">Every <span className="font-mono">{entry.program}</span> command</span>
            <span className="text-sm text-cx-muted">Forgets all of them now and ignores any you run later.</span>
          </button>
        )}
      </div>
      <p className="mt-3 text-sm text-cx-faint">Your shell's own history file is not touched. You can undo this from “Never tracked”.</p>
    </Dialog>
  )
}

function IgnoredDialog({ rules, onClose }: { rules: HistoryRule[]; onClose: () => void }): React.JSX.Element {
  const unignore = useHistoryStore((s) => s.unignore)
  return (
    <Dialog title="Never tracked" description="Cairix ignores these, now and in the future." onClose={onClose} width={560} footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      {rules.length === 0 ? (
        <p className="text-cx-muted">Nothing here yet. Use the <Ban size={12} className="inline" /> button on a command to stop tracking it.</p>
      ) : (
        <ul className="overflow-hidden rounded-xl border border-cx-border">
          {rules.map((r) => (
            <li key={`${r.kind}:${r.value}`} className="flex items-center gap-3 border-b border-cx-border/60 px-4 py-2 last:border-0">
              <Chip>{r.kind === 'program' ? 'every command' : 'command'}</Chip>
              <span className="min-w-0 flex-1 truncate font-mono text-sm" title={r.value}>{r.value}</span>
              <Button size="sm" onClick={() => void unignore(r)}>Track again</Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}

function RiskyDialog({ entry, onConfirm, onClose }: { entry: HistoryEntry; onConfirm: () => void; onClose: () => void }): React.JSX.Element {
  return (
    <Dialog title="Run this again?" onClose={onClose} width={500} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="danger" icon={Play} onClick={onConfirm}>Run</Button></>}>
      <p className="mb-2 flex items-start gap-2 text-cx-warning"><TriangleAlert size={16} className="mt-0.5 shrink-0" />This command deletes, forces a change, or runs as administrator.</p>
      <pre className="selectable overflow-x-auto whitespace-pre-wrap rounded-lg border border-cx-border bg-cx-surface p-3 font-mono text-sm">{entry.command}</pre>
    </Dialog>
  )
}

type Place = { id: string; label: string; path: string }

/** The project a folder belongs to: the most specific one that contains it. */
export function placeFor(path: string, places: Place[]): Place | undefined {
  let best: Place | undefined
  for (const p of places) if ((path === p.path || path.startsWith(p.path + '/')) && (!best || p.path.length > best.path.length)) best = p
  return best
}

function HookDialog({ rcFile, snippet, onClose }: { rcFile: string; snippet: string; onClose: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  async function enable(): Promise<void> {
    setBusy(true)
    try {
      await window.cairix.history.installHook()
      toast.success('Folder tracking is on. Open a new terminal tab to start.')
      onClose()
    } catch (e) {
      toast.error(errMsg(e))
      setBusy(false)
    }
  }
  return (
    <Dialog title="Record which folder commands run in" onClose={onClose} width={560} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={busy} onClick={() => void enable()}>Add to .zshrc</Button></>}>
      <p className="mb-3 text-cx-muted">Shell history does not say where a command ran. This adds a small zsh hook that notes the folder before each command, so Cairix can show it, filter by project, and re-run a command where it belongs.</p>
      <p className="mb-1.5 text-sm text-cx-muted">Cairix will add exactly this to <span className="font-mono">{rcFile.replace(/^\/Users\/[^/]+/, '~')}</span> (a backup is kept as <span className="font-mono">.zshrc.cairix-backup</span>):</p>
      <pre className="selectable overflow-x-auto whitespace-pre-wrap rounded-lg border border-cx-border bg-cx-surface p-3 font-mono text-xs">{snippet}</pre>
      <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-cx-muted">
        <li>Only new terminal tabs are affected. A command that starts with a space is never recorded.</li>
        <li>Commands with passwords or tokens are dropped, as before. Everything stays on this Mac.</li>
        <li>You can turn it off here at any time; that removes the block.</li>
      </ul>
    </Dialog>
  )
}

function Row({ e, onRun, onForget, place }: { e: HistoryEntry; onRun: () => void; onForget: () => void; place?: Place }): React.JSX.Element {
  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(e.command)
      toast.success('Copied command')
    } catch {
      toast.error('Could not copy to the clipboard.')
    }
  }
  return (
    <div className="grid items-center gap-3 border-b border-cx-border/60 px-4 last:border-0 hover:bg-cx-hover/40" style={{ gridTemplateColumns: '56px minmax(0,1fr) 96px 112px', paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
      <span className="tabular-nums text-md font-semibold" title={`Run ${e.count} time${e.count === 1 ? '' : 's'}`}>{e.count}×</span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="selectable truncate font-mono text-sm font-medium" title={e.command}>{e.command}</span>
          {e.risky && <Chip tone="warning" title="Asks before re-running">careful</Chip>}
          {e.interactive && <Chip title="Needs a real terminal: re-runs in Terminal.app"><SquareTerminal size={10} /> terminal</Chip>}
          {e.folders.length > 0 && (
            <Chip title={`Run in:\n${e.folders.map((f) => `${f.path} (${f.count}×)`).join('\n')}`}><FolderOpen size={10} /> {place ? place.label : e.folders[0].path.split('/').pop() || '/'}{e.folders.length > 1 ? ` +${e.folders.length - 1}` : ''}</Chip>
          )}
        </span>
        <span className="mt-0.5 block truncate text-sm text-cx-muted" title={e.description}>{e.description}</span>
      </span>
      <span className="text-sm text-cx-muted" title={new Date(e.lastRun).toLocaleString()}>{lastRunLabel(e.lastRun)}</span>
      <span className="flex justify-end gap-0.5">
        <IconButton icon={Copy} label="Copy command" onClick={() => void copy()} />
        <IconButton icon={Ban} label={`Never track ${e.command}`} onClick={onForget} />
        <Button size="sm" variant="primary" icon={Play} onClick={onRun} aria-label={`Run ${e.command} again`}>Run</Button>
      </span>
    </div>
  )
}

/** Commands you run in any terminal, with counts, plain-English meaning and one-click re-run. */
export function HistoryView(): React.JSX.Element {
  const snapshot = useHistoryStore((s) => s.snapshot)
  const rerun = useHistoryStore((s) => s.rerun)
  const workspaces = useProjectsStore((s) => s.workspaces)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('count')
  const [shown, setShown] = useState(PAGE)
  const [where, setWhere] = useState('auto')
  const [inProject, setInProject] = useState('')
  const [hookOpen, setHookOpen] = useState(false)
  const [forgetting, setForgetting] = useState<HistoryEntry | null>(null)
  const [confirming, setConfirming] = useState<HistoryEntry | null>(null)
  const [showRules, setShowRules] = useState(false)

  const entries = snapshot?.entries ?? []
  const sorted = useMemo(() => [...entries].sort(SORTS[sort]), [entries, sort])
  const places = useMemo(
    (): Place[] => workspaces.filter((w) => w.trusted).flatMap((w) => w.projects.map((p) => ({ id: p.id, label: projectLabel({ project: p, workspace: w }), path: p.path }))),
    [workspaces]
  )
  const scope = places.find((p) => p.id === inProject)
  const filtered = useMemo(
    () => sorted.filter((e) => matchesQuery(e, query) && (!scope || e.folders.some((f) => f.path === scope.path || f.path.startsWith(scope.path + '/')))),
    [sorted, query, scope]
  )
  const runs = useMemo(() => entries.reduce((a, e) => a + e.count, 0), [entries])

  /** Where a re-run happens: where it was seen (if that is inside a trusted project), your choice, or home. */
  const target = (e: HistoryEntry): { projectId?: string; folder?: string } => {
    if (where === 'home') return {}
    if (where !== 'auto') return { projectId: where }
    const seen = e.folders.find((f) => placeFor(f.path, places))
    return seen ? { folder: seen.path } : {}
  }
  const run = (e: HistoryEntry, confirmed = false): void => void rerun(e.id, e.command, { ...target(e), confirmed })
  const start = (e: HistoryEntry): void => (e.risky ? setConfirming(e) : run(e))
  const rules = snapshot?.rules ?? []
  const foundAny = snapshot?.sources.some((s) => s.found) ?? false

  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Commands</h1>
          <p className="mt-0.5 text-cx-muted">
            {snapshot ? <>{entries.length.toLocaleString()} commands · run {runs.toLocaleString()} times, from your shell history</> : 'Reading your shell history…'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="no-drag flex h-8 w-60 items-center gap-2 rounded-lg border border-cx-border bg-cx-raised px-2.5 focus-within:border-cx-accent">
            <Search size={14} className="text-cx-faint" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setShown(PAGE) }} placeholder="Filter commands" aria-label="Filter commands" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-cx-faint" />
          </label>
          <Segmented value={sort} onChange={setSort} options={[{ value: 'count', label: 'Most run' }, { value: 'recent', label: 'Recent' }, { value: 'alpha', label: 'A–Z' }]} />
          <Button icon={Ban} onClick={() => setShowRules(true)}>Never tracked{rules.length > 0 ? ` (${rules.length})` : ''}</Button>
        </div>
      </div>

      <div className="mb-3 flex items-center gap-2 text-sm text-cx-muted">
        <label htmlFor="rerun-where">Re-run in</label>
        <select id="rerun-where" value={where} onChange={(e) => setWhere(e.target.value)} className="no-drag h-7 max-w-[260px] rounded-lg border border-cx-border bg-cx-raised px-2 outline-none focus:border-cx-accent">
          <option value="auto">Where it was run</option>
          <option value="home">Home folder</option>
          {places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <span className="text-cx-faint">{snapshot?.hook.recording ? 'Falls back to your home folder when it was run outside your trusted projects.' : 'Turn on folder tracking below to re-run commands where they belong. Until then: home folder.'}</span>
        {snapshot?.hook.recording && places.length > 0 && (
          <>
            <label htmlFor="in-project" className="ml-auto">Only commands run in</label>
            <select id="in-project" value={inProject} onChange={(e) => setInProject(e.target.value)} className="no-drag h-7 max-w-[200px] rounded-lg border border-cx-border bg-cx-raised px-2 outline-none focus:border-cx-accent">
              <option value="">Anywhere</option>
              {places.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </>
        )}
      </div>

      {snapshot && !snapshot.tracking && (
        <p className="mb-4 rounded-lg bg-cx-warning/12 p-3 text-cx-warning" role="status">Tracking is off. Turn on “Commands” under Settings → Modules to count new commands.</p>
      )}

      {snapshot && snapshot.tracking && (
        snapshot.hook.installed ? (
          <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-cx-muted" role="status">
            <FolderOpen size={14} className="text-cx-success" />
            {snapshot.hook.recording ? 'Folder tracking is on.' : 'Folder tracking is on. Open a new terminal tab and run a command to start learning folders.'}
            <button onClick={() => void window.cairix.history.removeHook().catch((e) => toast.error(errMsg(e)))} className="no-drag text-cx-accent-text hover:underline">Turn off</button>
          </p>
        ) : (
          <div className="mb-3 flex items-center gap-3 rounded-xl border border-cx-border bg-cx-raised px-4 py-3">
            <FolderOpen size={18} className="shrink-0 text-cx-muted" />
            <div className="min-w-0 flex-1">
              <p className="font-medium">Know where each command ran</p>
              <p className="text-sm text-cx-muted">Shell history has no folder. An optional zsh hook adds it, so you can filter by project and re-run commands in the right place.</p>
            </div>
            <Button onClick={() => setHookOpen(true)}>Set up…</Button>
          </div>
        )
      )}

      {filtered.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
          <div className="grid gap-3 border-b border-cx-border bg-cx-surface px-4 py-2 cx-label" style={{ gridTemplateColumns: '56px minmax(0,1fr) 96px 112px' }}>
            <span>Runs</span><span>Command</span><span>Last run</span><span />
          </div>
          {filtered.slice(0, shown).map((e) => <Row key={e.id} e={e} place={e.folders[0] ? placeFor(e.folders[0].path, places) : undefined} onRun={() => start(e)} onForget={() => setForgetting(e)} />)}
          {filtered.length > shown && (
            <div className="flex justify-center border-t border-cx-border/60 p-3">
              <Button onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, filtered.length - shown)} more of {(filtered.length - shown).toLocaleString()}</Button>
            </div>
          )}
        </div>
      ) : snapshot ? (
        <EmptyState icon={SquareTerminal} title={query ? 'Nothing matches that filter' : foundAny ? 'No commands yet' : 'No shell history found'}>
          {query
            ? 'Try fewer words. The filter looks at the command and its description.'
            : foundAny
              ? 'Run something in any terminal and it shows up here within a few seconds.'
              : `Cairix reads ${snapshot.sources.map((s) => s.path.replace(/^\/Users\/[^/]+/, '~')).join(', ')}. Run a command in your terminal to create one.`}
        </EmptyState>
      ) : null}

      <p className="mt-3 text-sm text-cx-faint">
        Counts come from your shell's history file, so commands from any terminal app are included. Commands that contain passwords, tokens or keys are never stored. Nothing leaves your Mac.
      </p>

      {forgetting && <NeverTrackDialog entry={forgetting} onClose={() => setForgetting(null)} />}
      {confirming && <RiskyDialog entry={confirming} onClose={() => setConfirming(null)} onConfirm={() => { run(confirming, true); setConfirming(null) }} />}
      {hookOpen && snapshot && <HookDialog rcFile={snapshot.hook.rcFile} snippet={snapshot.hook.snippet} onClose={() => setHookOpen(false)} />}
      {showRules && <IgnoredDialog rules={rules} onClose={() => setShowRules(false)} />}
    </div>
  )
}
