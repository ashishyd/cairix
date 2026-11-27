import { ArrowRight, Bot, CircleCheck, FolderTree, GitCompare, Pin, PinOff, Play, Plug, Square } from 'lucide-react'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import type { ChangesOverviewItem, FlightEvent, Project, RunRecord, ScriptDef } from '@shared/types'
import type { WidgetType } from '@shared/dashboard'
import { Button, Chip, IconButton, StatusDot } from '@/components/ui'
import { cx, errMsg, formatKb, timeAgo } from '@/lib/util'
import { useAgentsStore } from '@/stores/agents-store'
import { isDevServer, usePortsStore } from '@/stores/ports-store'
import { findProjectIn, projectLabel, useProjectsStore } from '@/stores/projects-store'
import { useRunsStore } from '@/stores/runs-store'
import { isActive, runForScript, useScriptsStore } from '@/stores/scripts-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'

const Empty = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }): React.JSX.Element => (
  <div className="rounded-lg border border-dashed border-cx-border p-3.5">
    <p className="text-cx-muted">{children}</p>
    {action && <div className="mt-2.5">{action}</div>}
  </div>
)

function Row({ onClick, children, label }: { onClick?: () => void; children: React.ReactNode; label?: string }): React.JSX.Element {
  const cls = 'no-drag flex w-full items-center gap-2.5 border-b border-cx-border/60 px-1 py-2 text-left last:border-0'
  return onClick ? (
    <button onClick={onClick} aria-label={label} className={cx(cls, 'rounded-md hover:bg-cx-hover/50')}>{children}</button>
  ) : (
    <div className={cls}>{children}</div>
  )
}

/** Pending changes per project, refreshed while the window is visible. Null until the first answer. */
function useChangesOverview(): ChangesOverviewItem[] | null {
  const [items, setItems] = useState<ChangesOverviewItem[] | null>(null)
  useEffect(() => {
    let live = true
    const load = (): void => {
      if (document.hidden) return
      window.cairix.changes.overview().then((o) => live && setItems(o), () => undefined)
    }
    load()
    const t = setInterval(load, 15_000)
    return () => {
      live = false
      clearInterval(t)
    }
  }, [])
  return items
}

// ───────────────────────── Overview ─────────────────────────

function Stat({ icon: Icon, label, value, sub, onClick }: { icon: typeof Plug; label: string; value: string; sub?: string; onClick?: () => void }): React.JSX.Element {
  return (
    <button onClick={onClick} disabled={!onClick} className="no-drag rounded-xl bg-cx-surface p-4 text-left transition-colors enabled:hover:bg-cx-hover">
      <span className="flex items-center gap-2 text-cx-muted"><Icon size={14} /> {label}</span>
      <span className="mt-2 block text-2xl font-semibold leading-none tracking-tight tabular-nums">{value}</span>
      {sub && <span className="mt-1.5 block text-sm text-cx-faint">{sub}</span>}
    </button>
  )
}

function StatsWidget(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const workspaces = useProjectsStore((s) => s.workspaces)
  const runs = useScriptsStore((s) => s.runs)
  const snapshot = usePortsStore((s) => s.snapshot)
  const active = Object.values(runs).filter(isActive).length
  const servers = new Map<number, number>()
  for (const e of (snapshot?.entries ?? []).filter(isDevServer)) servers.set(e.footprintPid, e.treeRssKb)
  const projects = workspaces.reduce((n, w) => n + w.projects.length, 0)
  return (
    <div className="grid grid-cols-3 gap-3">
      <Stat icon={FolderTree} label="Projects" value={String(projects)} sub={`in ${workspaces.length} folder${workspaces.length === 1 ? '' : 's'}`} />
      <Stat icon={Play} label="Scripts running" value={String(active)} sub={active ? 'started from Cairix' : 'nothing started yet'} />
      <Stat icon={Plug} label="Dev servers" value={String(servers.size)} sub={snapshot ? `using ${formatKb([...servers.values()].reduce((a, b) => a + b, 0))}` : 'scanning…'} onClick={() => go({ kind: 'machine', page: 'ports' })} />
    </div>
  )
}

// ───────────────────────── Running / listening ─────────────────────────

function RunningWidget(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const runs = useScriptsStore((s) => s.runs)
  const workspaces = useProjectsStore((s) => s.workspaces)
  const first = workspaces.flatMap((w) => w.projects)[0]
  const active = useMemo(() => Object.values(runs).filter(isActive).sort((a, b) => b.startedAt - a.startedAt), [runs])
  if (active.length === 0) {
    return (
      <Empty
        action={first && (
          <button onClick={() => go({ kind: 'project', projectId: first.id, tab: 'scripts' })} className="no-drag flex items-center gap-1 text-sm font-medium text-cx-accent-text hover:underline">
            Open Scripts <ArrowRight size={11} />
          </button>
        )}
      >
        Nothing yet. Open a project and press Run.
      </Empty>
    )
  }
  return (
    <ul>
      {active.slice(0, 6).map((r) => (
        <li key={r.runId}>
          <Row onClick={() => r.projectId !== 'action' && go({ kind: 'project', projectId: r.projectId, tab: 'scripts' })} label={`${r.scriptName} in ${r.projectName}`}>
            <StatusDot tone="success" pulse />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-sm font-medium">{r.scriptName}</span>
              <span className="block truncate text-sm text-cx-faint">{r.projectName}</span>
            </span>
            {r.ports.map((p) => <Chip key={p} tone="success">:{p}</Chip>)}
          </Row>
        </li>
      ))}
    </ul>
  )
}

function ListeningWidget(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const snapshot = usePortsStore((s) => s.snapshot)
  const servers = useMemo(() => {
    const by = new Map<number, { kb: number; ports: number[]; name: string }>()
    for (const e of (snapshot?.entries ?? []).filter(isDevServer)) {
      const cur = by.get(e.footprintPid)
      by.set(e.footprintPid, { kb: e.treeRssKb, ports: [...(cur?.ports ?? []), e.port], name: e.projectName ?? e.framework ?? e.name })
    }
    return [...by.values()]
  }, [snapshot])
  return servers.length === 0 ? (
    <Empty
      action={
        <button onClick={() => go({ kind: 'machine', page: 'ports' })} className="no-drag flex items-center gap-1 text-sm font-medium text-cx-accent-text hover:underline">
          Show all ports <ArrowRight size={11} />
        </button>
      }
    >
      No dev servers are listening. Run a script and it will show up here.
    </Empty>
  ) : (
    <>
      <ul>
        {servers.slice(0, 6).map((s, i) => (
          <li key={i}>
            <Row>
              <span className="min-w-0 flex-1 truncate">{s.name}</span>
              {s.ports.slice(0, 3).map((p) => <Chip key={p}>:{p}</Chip>)}
              <span className="w-16 text-right text-sm tabular-nums text-cx-muted">{formatKb(s.kb)}</span>
            </Row>
          </li>
        ))}
      </ul>
      <button onClick={() => go({ kind: 'machine', page: 'ports' })} className="no-drag mt-2 flex items-center gap-1 text-sm text-cx-accent-text hover:underline">All ports <ArrowRight size={11} /></button>
    </>
  )
}

// ───────────────────────── Agents ─────────────────────────

function AgentsWidget(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const snap = useAgentsStore((s) => s.snapshot)
  const sessions = snap?.sessions ?? []
  if (!snap) return <Empty>Looking for agents…</Empty>
  if (sessions.length === 0) {
    return (
      <Empty
        action={
          <button onClick={() => go({ kind: 'machine', page: 'agents' })} className="no-drag flex items-center gap-1 text-sm font-medium text-cx-accent-text hover:underline">
            Open Agents <ArrowRight size={11} />
          </button>
        }
      >
        No agents are running. Start Claude Code or Cursor, or give a task from a project.
      </Empty>
    )
  }
  return (
    <>
      <ul>
        {sessions.slice(0, 5).map((s) => (
          <li key={s.id}>
            <Row onClick={() => s.projectId ? go({ kind: 'project', projectId: s.projectId, tab: 'tasks' }) : go({ kind: 'machine', page: 'agents' })} label={s.title}>
              <StatusDot tone={s.status === 'busy' ? 'warning' : s.status === 'idle' ? 'muted' : 'success'} pulse={s.status === 'busy'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.title}</span>
                <span className="block truncate text-sm text-cx-faint">{s.kind === 'claude' ? 'Claude Code' : 'Cursor'}{s.projectName ? ` · ${s.projectName}` : ''}</span>
              </span>
              <span className="text-sm text-cx-muted">{s.status === 'busy' ? 'Working' : s.status === 'idle' ? 'Idle' : 'Running'}</span>
            </Row>
          </li>
        ))}
      </ul>
      <button onClick={() => go({ kind: 'machine', page: 'agents' })} className="no-drag mt-2 flex items-center gap-1 text-sm text-cx-accent-text hover:underline"><Bot size={11} /> All agents <ArrowRight size={11} /></button>
    </>
  )
}

// ───────────────────────── Pending changes ─────────────────────────

function ChangesWidget(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const workspaces = useProjectsStore((s) => s.workspaces)
  const gitProject = workspaces.flatMap((w) => w.projects).find((p) => p.hasGit)
  const items = useChangesOverview()
  if (!items) return <Empty>Checking your projects…</Empty>
  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <p className="flex items-center gap-2 rounded-lg bg-cx-success/10 p-3.5 text-cx-success"><CircleCheck size={15} /> Everything is committed.</p>
        {gitProject && (
          <button onClick={() => go({ kind: 'project', projectId: gitProject.id, tab: 'changes' })} className="no-drag flex items-center gap-1 px-1 text-sm font-medium text-cx-accent-text hover:underline">
            Open Changes <ArrowRight size={11} />
          </button>
        )}
      </div>
    )
  }
  return (
    <ul>
      {items.slice(0, 6).map((c) => (
        <li key={c.projectId}>
          <Row onClick={() => go({ kind: 'project', projectId: c.projectId, tab: 'changes' })} label={`${c.name}: ${c.files} changed files`}>
            <GitCompare size={14} className="shrink-0 text-cx-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-sm text-cx-faint">{c.branch ?? 'detached'} · {c.files} changed file{c.files === 1 ? '' : 's'}</span>
            </span>
            {c.errors > 0 && <Chip tone="danger">{c.errors} must fix</Chip>}
            {c.warnings > 0 && <Chip tone="warning">{c.warnings} to check</Chip>}
          </Row>
        </li>
      ))}
      {items.length > 6 && <li className="pt-2 text-sm text-cx-faint">+{items.length - 6} more</li>}
    </ul>
  )
}

// ───────────────────────── Needs you ─────────────────────────

const DAY_MS = 24 * 3600_000

/** The newest finished run of each script that failed in the last day and has not passed since. */
function latestFailures(records: RunRecord[], now: number): RunRecord[] {
  const latest = new Map<string, RunRecord>()
  for (const r of records) {
    const key = `${r.projectId}:${r.scriptName}`
    const cur = latest.get(key)
    if (!cur || r.endedAt > cur.endedAt) latest.set(key, r)
  }
  return [...latest.values()].filter((r) => r.status === 'failed' && now - r.endedAt < DAY_MS).sort((a, b) => b.endedAt - a.endedAt)
}

function NeedCard({ tone, label, title, detail, action, onClick }: { tone: 'danger' | 'warning' | 'accent'; label: string; title: string; detail: string; action: string; onClick: () => void }): React.JSX.Element {
  return (
    <li className={cx('flex flex-col gap-2 rounded-xl border bg-cx-raised p-4', tone === 'warning' ? 'border-cx-warning/60' : 'border-cx-border')}>
      <span className="flex items-center gap-2 text-xs font-semibold text-cx-faint">
        <StatusDot tone={tone === 'accent' ? 'muted' : tone} />
        {label}
      </span>
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-cx-muted">{detail}</p>
      <div className="mt-auto pt-1">
        <Button size="sm" variant={tone === 'warning' ? 'primary' : 'secondary'} onClick={onClick}>{action}</Button>
      </div>
    </li>
  )
}

/** Only data Home already has: failed runs, must-fix problems in pending changes, and Claude sessions that are idle (waiting for input). */
function NeedsWidget(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const snap = useAgentsStore((s) => s.snapshot)
  const records = useRunsStore((s) => s.records)
  const items = useChangesOverview()
  if (!items || !snap) return <Empty>Checking your projects and agents…</Empty>
  const failures = latestFailures(records, Date.now())
  const broken = items.filter((c) => c.errors > 0)
  const waiting = snap.sessions.filter((s) => s.kind === 'claude' && s.status === 'idle')
  if (failures.length === 0 && broken.length === 0 && waiting.length === 0) {
    return <p className="flex items-center gap-2 rounded-lg bg-cx-success/10 p-3.5 text-cx-success"><CircleCheck size={15} /> Nothing needs you right now.</p>
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {waiting.map((s) => (
        <NeedCard key={`a-${s.id}`} tone="warning" label={`Agent${s.projectName ? ` · ${s.projectName}` : ''}`} title="Claude Code is waiting for you" detail={s.title} action="Open agent"
          onClick={() => (s.projectId ? go({ kind: 'project', projectId: s.projectId, tab: 'tasks' }) : go({ kind: 'machine', page: 'agents' }))} />
      ))}
      {failures.slice(0, 3).map((r) => (
        <NeedCard key={`r-${r.runId}`} tone="danger" label={`Run · ${r.projectName}`} title={`${r.scriptName} failed ${timeAgo(r.endedAt)}`} detail={r.exitCode != null ? `Exited with code ${r.exitCode}. Open Runs to read the output.` : 'Open Runs to read the output.'} action="Open the log"
          onClick={() => go({ kind: 'machine', page: 'runs' })} />
      ))}
      {broken.map((c) => (
        <NeedCard key={`c-${c.projectId}`} tone="danger" label={`Review · ${c.name}`} title={`${c.errors} ${c.errors === 1 ? 'problem' : 'problems'} in your changes`} detail={`${c.branch ?? 'detached'} · ${c.files} changed file${c.files === 1 ? '' : 's'}`} action="Review"
          onClick={() => go({ kind: 'project', projectId: c.projectId, tab: 'changes' })} />
      ))}
    </ul>
  )
}

// ───────────────────────── Projects ─────────────────────────

const KIND_LABEL: Record<string, string> = { node: 'Node', python: 'Python', rust: 'Rust', go: 'Go', compose: 'Compose', make: 'Make' }
const MAX_PROJECT_CARDS = 6

function ProjectCard({ project, change, running, last }: { project: Project; change?: ChangesOverviewItem; running: number; last?: RunRecord }): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const tone = running > 0 ? 'success' : change && change.errors > 0 ? 'danger' : change ? 'warning' : 'muted'
  return (
    <li className="flex flex-col rounded-xl border border-cx-border bg-cx-raised">
      <div className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2">
          <StatusDot tone={tone} pulse={running > 0} />
          <span className="min-w-0 truncate font-semibold">{project.name}</span>
          {project.kinds[0] && <Chip>{KIND_LABEL[project.kinds[0]] ?? project.kinds[0]}</Chip>}
        </div>
        <p className="truncate font-mono text-xs text-cx-faint" title={project.path}>{project.relPath || project.path}</p>
        <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-cx-muted">
          {change?.branch && <span className="font-mono">{change.branch}</span>}
          <span>{change ? `${change.files} changed file${change.files === 1 ? '' : 's'}` : 'No pending changes'}</span>
          {last && <span className={last.status === 'failed' ? 'text-cx-danger' : last.status === 'exited' ? 'text-cx-success' : undefined}>{last.scriptName} {last.status === 'failed' ? 'failed' : last.status === 'exited' ? 'passed' : 'stopped'} {timeAgo(last.endedAt)}</span>}
        </p>
      </div>
      <div className="mt-auto flex items-center gap-2 border-t border-cx-border/60 px-4 py-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-cx-faint">{running > 0 ? `${running} running` : 'Idle'}</span>
        <Button size="sm" onClick={() => go({ kind: 'project', projectId: project.id, tab: 'scripts' })}>Scripts</Button>
      </div>
    </li>
  )
}

/** Running projects first, then ones with pending changes, then the rest. */
function ProjectsWidget(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const workspaces = useProjectsStore((s) => s.workspaces)
  const runs = useScriptsStore((s) => s.runs)
  const records = useRunsStore((s) => s.records)
  const changes = useChangesOverview()
  const all = workspaces.flatMap((w) => w.projects)
  const runningBy = new Map<string, number>()
  for (const r of Object.values(runs).filter(isActive)) runningBy.set(r.projectId, (runningBy.get(r.projectId) ?? 0) + 1)
  const changeBy = new Map((changes ?? []).map((c) => [c.projectId, c]))
  const rank = (p: Project): number => (runningBy.has(p.id) ? 0 : changeBy.has(p.id) ? 1 : 2)
  const shown = [...all].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_PROJECT_CARDS)
  const lastBy = (id: string): RunRecord | undefined => records.filter((r) => r.projectId === id).sort((a, b) => b.endedAt - a.endedAt)[0]
  if (all.length === 0) return <Empty>Add a folder and its projects show up here.</Empty>
  return (
    <>
      <ul className="grid gap-3 md:grid-cols-2">
        {shown.map((p) => <ProjectCard key={p.id} project={p} change={changeBy.get(p.id)} running={runningBy.get(p.id) ?? 0} last={lastBy(p.id)} />)}
      </ul>
      {all.length > shown.length && (
        <p className="mt-2 text-sm text-cx-faint">
          +{all.length - shown.length} more in the sidebar.{' '}
          <button className="no-drag text-cx-accent-text hover:underline" onClick={() => go({ kind: 'project', projectId: all[0].id, tab: 'scripts' })}>Open first project</button>
        </p>
      )}
    </>
  )
}

// ───────────────────────── Since yesterday ─────────────────────────

function RecentWidget(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const [events, setEvents] = useState<FlightEvent[] | null>(null)
  useEffect(() => {
    const load = (): void => {
      if (!document.hidden) window.cairix.flight.list().then(setEvents, () => undefined)
    }
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [])
  if (!events) return <Empty>Reading the flight recorder…</Empty>
  const recent = events.filter((e) => Date.now() - e.at < DAY_MS).slice(0, 5)
  if (recent.length === 0) return <Empty>Nothing changed in your trusted projects in the last day.</Empty>
  return (
    <>
      <ul>
        {recent.map((e) => (
          <li key={e.id}>
            <Row>
              <span className="w-16 shrink-0 text-sm tabular-nums text-cx-faint">{timeAgo(e.at)}</span>
              <span className="min-w-0 flex-1 truncate"><span className="text-cx-muted">{e.projectName}:</span> {e.title}</span>
            </Row>
          </li>
        ))}
      </ul>
      <button onClick={() => go({ kind: 'machine', page: 'flight' })} className="no-drag mt-2 flex items-center gap-1 text-sm text-cx-accent-text hover:underline">Flight recorder <ArrowRight size={11} /></button>
    </>
  )
}

// ───────────────────────── Pinned scripts ─────────────────────────

function PinnedWidget(): React.JSX.Element {
  const pinned = useSettingsStore((s) => s.settings.pinnedScripts)
  const patch = useSettingsStore((s) => s.patch)
  const workspaces = useProjectsStore((s) => s.workspaces)
  const runs = useScriptsStore((s) => s.runs)
  const { run, stop } = useScriptsStore()
  const [defs, setDefs] = useState<Record<string, ScriptDef>>({})

  useEffect(() => {
    const projectIds = [...new Set(pinned.map((id) => id.split(':')[0]))]
    let live = true
    void Promise.allSettled(projectIds.map((p) => window.cairix.scripts.list(p))).then((res) => {
      if (!live) return
      const map: Record<string, ScriptDef> = {}
      for (const r of res) if (r.status === 'fulfilled') for (const d of r.value) map[d.id] = d
      setDefs(map)
    })
    return () => {
      live = false
    }
  }, [pinned, workspaces])

  if (pinned.length === 0) return <Empty>Pin a script with the <Pin size={12} className="inline" /> button on any project's Scripts tab and it shows up here.</Empty>
  return (
    <ul>
      {pinned.map((id) => {
        const def = defs[id]
        const ref = findProjectIn(workspaces, id.split(':')[0])
        const r = runForScript(runs, id)
        const active = !!r && isActive(r)
        const trusted = ref?.workspace.trusted ?? false
        return (
          <li key={id}>
            <Row>
              <StatusDot tone={active ? 'success' : 'muted'} pulse={active} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-sm font-medium">{def?.name ?? id.split(':').at(-1)}</span>
                <span className="block truncate text-sm text-cx-faint">{ref ? projectLabel(ref) : 'Project removed'}</span>
              </span>
              {active && r?.ports.map((p) => <Chip key={p} tone="success">:{p}</Chip>)}
              {active ? (
                <IconButton icon={Square} label={`Stop ${def?.name ?? 'script'}`} onClick={() => r && void stop(r.runId)} />
              ) : (
                <IconButton icon={Play} label={`Run ${def?.name ?? 'script'}`} disabled={!def || !trusted} onClick={() => void run(id).catch((e) => toast.error(errMsg(e)))} />
              )}
              <IconButton icon={PinOff} label="Unpin" onClick={() => void patch({ pinnedScripts: pinned.filter((p) => p !== id) })} />
            </Row>
          </li>
        )
      })}
    </ul>
  )
}

export const WIDGET_COMPONENTS: Record<WidgetType, ComponentType> = {
  needs: NeedsWidget,
  stats: StatsWidget,
  running: RunningWidget,
  listening: ListeningWidget,
  agents: AgentsWidget,
  changes: ChangesWidget,
  projects: ProjectsWidget,
  recent: RecentWidget,
  pinned: PinnedWidget
}
