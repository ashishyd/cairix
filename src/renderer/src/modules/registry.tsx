import { Puzzle, Bot, Sparkles, Zap, GitCompare, Play, Plug, ScanSearch, Activity, SquareTerminal, History, KeyRound, GitBranch, HeartPulse, Container, CalendarClock, Keyboard, GraduationCap, type LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Project, Workspace } from '@shared/types'
import { TasksPanel } from './tasks/TasksPanel'
import { PluginsView } from './plugins/PluginsView'
import { ActionsView } from './actions/ActionsView'
import { AuditPanel } from './audit/AuditPanel'
import { ChangesPanel } from './changes/ChangesPanel'
import { AgentsView } from './agents/AgentsView'
import { RunsView } from './runs/RunsView'
import { HealthPanel } from './health/HealthPanel'
import { KeymapView } from './keymap/KeymapView'
import { LearnView } from './learn/LearnView'
import { ContainersView } from './containers/ContainersView'
import { SchedulesView } from './schedules/SchedulesView'
import { GitPanel } from './git/GitPanel'
import { EnvPanel } from './env/EnvPanel'
import { HistoryView } from './history/HistoryView'
import { ProcessesView } from './processes/ProcessesView'
import { PortsView, ProjectPorts } from './ports/PortsView'
import { ReviewPanel } from './review/ReviewPanel'
import { ScriptsPanel } from './scripts/ScriptsPanel'

export interface ProjectTabProps {
  project: Project
  workspace: Workspace
}

/**
 * What a module contributes to the UI. The manifest in shared/modules.ts says
 * which modules exist and whether they're enabled; this maps each id to its
 * components. A module can add a tab to every project, a page under
 * "Machine", or both. Nested review modules stay registered so Settings can
 * toggle them, but they are not shown as top-level tabs when Review is on.
 */
export interface RendererModule {
  id: string
  title: string
  icon: LucideIcon
  projectTab?: ComponentType<ProjectTabProps>
  /** When set, this tab is folded into another project tab (currently Review). */
  nestUnder?: 'review'
  machinePage?: ComponentType
}

export const RENDERER_MODULES: RendererModule[] = [
  { id: 'scripts', title: 'Scripts', icon: Play, projectTab: ScriptsPanel },
  { id: 'env', title: 'Env', icon: KeyRound, projectTab: EnvPanel },
  { id: 'git', title: 'Git', icon: GitBranch, projectTab: GitPanel },
  { id: 'health', title: 'Health', icon: HeartPulse, projectTab: HealthPanel },
  { id: 'review', title: 'Review', icon: GitCompare, projectTab: ReviewPanel },
  { id: 'changes', title: 'Changes', icon: GitCompare, projectTab: ChangesPanel, nestUnder: 'review' },
  { id: 'tasks', title: 'Tasks', icon: Sparkles, projectTab: TasksPanel, nestUnder: 'review' },
  { id: 'audit', title: 'Audit', icon: ScanSearch, projectTab: AuditPanel, nestUnder: 'review' },
  { id: 'ports', title: 'Ports', icon: Plug, projectTab: ProjectPorts, machinePage: PortsView },
  { id: 'processes', title: 'Processes', icon: Activity, machinePage: ProcessesView },
  { id: 'keymap', title: 'Keymap', icon: Keyboard, machinePage: KeymapView },
  { id: 'learn', title: 'Daily learn', icon: GraduationCap, machinePage: LearnView },
  { id: 'containers', title: 'Containers', icon: Container, machinePage: ContainersView },
  { id: 'schedules', title: 'Schedules', icon: CalendarClock, machinePage: SchedulesView },
  { id: 'runs', title: 'Runs', icon: History, machinePage: RunsView },
  { id: 'history', title: 'Commands', icon: SquareTerminal, machinePage: HistoryView },
  { id: 'agents', title: 'Agents', icon: Bot, machinePage: AgentsView },
  { id: 'actions', title: 'Actions', icon: Zap, machinePage: ActionsView },
  { id: 'plugins', title: 'Plugins', icon: Puzzle, machinePage: PluginsView }
]
