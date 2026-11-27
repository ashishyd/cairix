import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  House,
  Bot,
  Package,
  Plug,
  Activity,
  GraduationCap,
  Keyboard,
  CalendarClock,
  Container,
  History,
  SquareTerminal,
  RefreshCw,
  Settings,
  ShieldAlert,
  Terminal,
  Puzzle,
  Zap,
  Wifi,
  Gauge,
  Layers,
  Rewind,
  Trash2,
  type LucideIcon
} from 'lucide-react'
import { useMemo } from 'react'
import { MODULES, isModuleEnabled } from '@shared/modules'
import type { Project, Workspace } from '@shared/types'
import { cx } from '@/lib/util'
import { useShortcut } from '@/lib/commands'
import { busyCount, useAgentsStore } from '@/stores/agents-store'
import { usePortsStore, countServers } from '@/stores/ports-store'
import { useProjectsStore } from '@/stores/projects-store'
import { isActive, useScriptsStore } from '@/stores/scripts-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore } from '@/stores/ui-store'
import { BrandLogo } from './BrandLogo'
import { IconButton, StatusDot } from './ui'

const MACHINE_ICONS: Record<string, LucideIcon> = { ports: Plug, processes: Activity, keymap: Keyboard, learn: GraduationCap, containers: Container, schedules: CalendarClock, runs: History, history: SquareTerminal, agents: Bot, actions: Zap, plugins: Puzzle, wifi: Wifi, slowdown: Gauge, shareddeps: Layers, flight: Rewind }

// Machine pages split by how you use them; any id not listed lands in Tools so new modules still show up.
const MACHINE_GROUPS: { title: string; ids: string[] }[] = [
  { title: 'This Mac', ids: ['ports', 'processes', 'containers', 'agents', 'slowdown', 'wifi', 'shareddeps'] },
  { title: 'Automate', ids: ['schedules', 'runs', 'history', 'actions', 'flight', 'plugins'] },
  { title: 'More', ids: [] }
]

/** The sidebar group a machine page sits in, so the top bar's breadcrumb names the same one. */
export function navGroupOf(id: string): string {
  if (MODULES.find((m) => m.id === id)?.scope === 'learn') return 'Learn'
  return MACHINE_GROUPS.find((g) => g.ids.includes(id))?.title ?? 'More'
}

function NavItem({ icon: Icon, label, active, onClick, trailing }: { icon: LucideIcon; label: string; active: boolean; onClick: () => void; trailing?: React.ReactNode }): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'no-drag group flex w-full items-center gap-2 rounded-lg px-2.5 py-[5px] text-left transition-colors',
        active ? 'bg-cx-accent/14 font-medium text-cx-accent-text' : 'text-cx-text/85 hover:bg-cx-hover/70'
      )}
    >
      <Icon size={15} className={active ? '' : 'text-cx-muted'} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {trailing}
    </button>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between px-2.5">
        <span className="cx-label">{title}</span>
        {action}
      </div>
      {children}
    </div>
  )
}

/** Label relative to the parent so nested apps read `apps/web`, not `viblix/apps/web`. */
function relativeLabel(p: Project, parent: Project | undefined, ws: Workspace): string {
  if (!parent) return p.relPath || ws.name
  return p.relPath.slice(parent.relPath.length).replace(/^\//, '') || p.name
}

function ProjectNode({ project, ws, depth, byParent, runningIds }: { project: Project; ws: Workspace; depth: number; byParent: Map<string | null, Project[]>; runningIds: Set<string> }): React.JSX.Element {
  const { view, go, collapsed, toggleCollapsed } = useUiStore()
  const kids = byParent.get(project.id) ?? []
  const parent = project.parentId ? ws.projects.find((p) => p.id === project.parentId) : undefined
  const open = !collapsed.has(project.id)
  const active = view.kind === 'project' && view.projectId === project.id
  const running = runningIds.has(project.id)

  return (
    <div>
      <div
        className={cx(
          'no-drag group flex items-center rounded-lg pr-1.5 transition-colors',
          active ? 'bg-cx-accent/14 text-cx-accent-text' : 'text-cx-text/85 hover:bg-cx-hover/70'
        )}
        style={{ paddingLeft: 6 + depth * 14 }}
      >
        {kids.length > 0 ? (
          <button onClick={() => toggleCollapsed(project.id)} aria-label={open ? 'Collapse' : 'Expand'} className="flex h-6 w-5 items-center justify-center text-cx-faint hover:text-cx-text">
            {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button
          onClick={() => go({ kind: 'project', projectId: project.id, tab: 'scripts' })}
          title={project.path}
          aria-current={active ? 'page' : undefined}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-[5px] text-left"
        >
          <Package size={14} className={active ? '' : 'text-cx-muted'} />
          <span className={cx('min-w-0 flex-1 truncate', active && 'font-medium')}>{relativeLabel(project, parent, ws)}</span>
          {running && <StatusDot tone="success" pulse />}
        </button>
      </div>
      {open && kids.map((k) => <ProjectNode key={k.id} project={k} ws={ws} depth={depth + 1} byParent={byParent} runningIds={runningIds} />)}
    </div>
  )
}

function WorkspaceNode({ ws, runningIds }: { ws: Workspace; runningIds: Set<string> }): React.JSX.Element {
  const { collapsed, toggleCollapsed } = useUiStore()
  const { rescan, remove, setTrust } = useProjectsStore()
  const open = !collapsed.has(ws.id)
  const byParent = useMemo(() => {
    const map = new Map<string | null, Project[]>()
    for (const p of ws.projects) map.set(p.parentId, [...(map.get(p.parentId) ?? []), p])
    return map
  }, [ws.projects])
  const roots = byParent.get(null) ?? []

  return (
    <div className="mb-1">
      <div className="no-drag group flex items-center rounded-lg pr-1 hover:bg-cx-hover/50">
        <button onClick={() => toggleCollapsed(ws.id)} className="flex min-w-0 flex-1 items-center gap-1.5 px-1.5 py-[5px] text-left" aria-expanded={open}>
          {open ? <ChevronDown size={13} className="text-cx-faint" /> : <ChevronRight size={13} className="text-cx-faint" />}
          <Folder size={14} className="text-cx-muted" />
          <span className="min-w-0 flex-1 truncate font-medium" title={ws.path}>
            {ws.name}
          </span>
        </button>
        {!ws.trusted && (
          <IconButton icon={ShieldAlert} label="Not trusted: click to allow running scripts" className="text-cx-warning" onClick={() => void setTrust(ws.id, true)} />
        )}
        <span className="hidden items-center group-hover:flex">
          <IconButton icon={RefreshCw} label="Rescan for projects" size={13} onClick={() => void rescan(ws.id)} />
          <IconButton icon={Trash2} label="Remove folder from Cairix" size={13} tone="danger" onClick={() => void remove(ws.id)} />
        </span>
      </div>
      {open && (roots.length > 0 ? roots.map((p) => <ProjectNode key={p.id} project={p} ws={ws} depth={1} byParent={byParent} runningIds={runningIds} />) : <p className="px-8 py-1 text-sm text-cx-faint">No projects found</p>)}
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  const { view, go, setAddFolder, setSettings } = useUiStore()
  const kAdd = useShortcut('folder.add')
  const kSettings = useShortcut('settings.open')
  const workspaces = useProjectsStore((s) => s.workspaces)
  const runs = useScriptsStore((s) => s.runs)
  const snapshot = usePortsStore((s) => s.snapshot)
  const enabledModules = useSettingsStore((s) => s.settings.enabledModules)

  const runningIds = useMemo(() => new Set(Object.values(runs).filter(isActive).map((r) => r.projectId)), [runs])
  const machine = MODULES.filter((m) => m.scope === 'machine' && isModuleEnabled(m, enabledModules))
  const learn = MODULES.filter((m) => m.scope === 'learn' && isModuleEnabled(m, enabledModules))
  const claimed = new Set(MACHINE_GROUPS.flatMap((g) => g.ids))
  const machineGroups = MACHINE_GROUPS.map((g) => ({
    title: g.title,
    items: g.ids.length > 0 ? g.ids.flatMap((id) => machine.filter((m) => m.id === id)) : machine.filter((m) => !claimed.has(m.id))
  })).filter((g) => g.items.length > 0)
  const servers = countServers(snapshot)
  const working = busyCount(useAgentsStore((s) => s.snapshot))

  return (
    <aside
      className="sidebar-bg drag flex h-full w-[256px] shrink-0 flex-col border-r border-cx-border/70 pt-[52px]"
      aria-label="Sidebar"
    >
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <NavItem icon={House} label="Today" active={view.kind === 'home'} onClick={() => go({ kind: 'home' })} />

        <Section title="Projects" action={<IconButton icon={FolderPlus} label={`Add a folder${kAdd ? ` (${kAdd})` : ''}`} size={14} onClick={() => setAddFolder(true)} />}>
          {workspaces.length === 0 ? (
            <button onClick={() => setAddFolder(true)} className="no-drag mx-1 mt-1 flex w-[calc(100%-8px)] items-center gap-2 rounded-lg border border-dashed border-cx-border px-3 py-2.5 text-left text-cx-muted transition-colors hover:border-cx-accent/60 hover:text-cx-accent-text">
              <FolderPlus size={15} />
              Add your first folder
            </button>
          ) : (
            workspaces.map((ws) => <WorkspaceNode key={ws.id} ws={ws} runningIds={runningIds} />)
          )}
        </Section>

        {machineGroups.map((g) => (
          <Section key={g.title} title={g.title}>
            {g.items.map((m) => (
              <NavItem
                key={m.id}
                icon={MACHINE_ICONS[m.id] ?? Terminal}
                label={m.title}
                active={view.kind === 'machine' && view.page === m.id}
                onClick={() => go({ kind: 'machine', page: m.id })}
                trailing={
                  m.id === 'ports' && servers > 0 ? (
                    <span className="rounded-md bg-cx-hover px-1.5 text-xs font-medium text-cx-muted">{servers}</span>
                  ) : m.id === 'agents' && working > 0 ? (
                    <span title={`${working} working`} className="rounded-md bg-cx-warning/15 px-1.5 text-xs font-medium text-cx-warning">{working}</span>
                  ) : undefined
                }
              />
            ))}
          </Section>
        ))}

        {learn.length > 0 && (
          <Section title="Learn">
            {learn.map((m) => (
              <NavItem key={m.id} icon={MACHINE_ICONS[m.id] ?? Terminal} label={m.title} active={view.kind === 'machine' && view.page === m.id} onClick={() => go({ kind: 'machine', page: m.id })} />
            ))}
          </Section>
        )}
      </div>

      <div className="no-drag flex items-center gap-2 border-t border-cx-border/70 px-3 py-2.5">
        <BrandLogo size={22} />
        <span className="flex-1 text-sm font-semibold tracking-tight">Cairix</span>
        <IconButton icon={Settings} label={`Settings${kSettings ? ` (${kSettings})` : ''}`} onClick={() => setSettings(true)} />
      </div>
    </aside>
  )
}
