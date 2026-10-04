/**
 * Dashboard layout: an ordered list of widgets on a two-column grid. Pure
 * functions so the rules (what can be added, how reordering behaves, what is
 * thrown away on load) are tested without any UI.
 */
export type WidgetSize = 'half' | 'full'

export interface DashboardItem {
  id: string
  /** A key of WIDGETS. Unknown types are kept in the file (a newer version may know them) but not drawn. */
  type: string
  size: WidgetSize
}

export interface WidgetMeta {
  title: string
  description: string
  defaultSize: WidgetSize
}

export const WIDGETS = {
  stats: { title: 'Overview', description: 'Projects, running scripts and dev servers at a glance.', defaultSize: 'full' },
  running: { title: 'Running from Cairix', description: 'Scripts and actions you started, with their ports.', defaultSize: 'half' },
  listening: { title: 'Listening now', description: 'Dev servers on this machine with their memory.', defaultSize: 'half' },
  agents: { title: 'Agents', description: 'Local Claude Code and Cursor agents and what they are doing.', defaultSize: 'half' },
  changes: { title: 'Pending changes', description: 'Projects with uncommitted work and any problems found in it.', defaultSize: 'half' },
  pinned: { title: 'Pinned scripts', description: 'Your favourite scripts, one click from Home.', defaultSize: 'half' }
} as const satisfies Record<string, WidgetMeta>

export type WidgetType = keyof typeof WIDGETS
export const isWidgetType = (t: string): t is WidgetType => t in WIDGETS

export const MAX_WIDGETS = 24

export const DEFAULT_DASHBOARD: DashboardItem[] = [
  { id: 'stats', type: 'stats', size: 'full' },
  { id: 'running', type: 'running', size: 'half' },
  { id: 'listening', type: 'listening', size: 'half' },
  { id: 'agents', type: 'agents', size: 'half' },
  { id: 'changes', type: 'changes', size: 'half' }
]

/** Moves `id` so it sits just before `beforeId` (or at the end when null). No-op for unknown ids. */
export function moveBefore(list: DashboardItem[], id: string, beforeId: string | null): DashboardItem[] {
  const item = list.find((i) => i.id === id)
  if (!item || id === beforeId) return list
  const rest = list.filter((i) => i.id !== id)
  const at = beforeId === null ? rest.length : rest.findIndex((i) => i.id === beforeId)
  if (at < 0) return list
  return [...rest.slice(0, at), item, ...rest.slice(at)]
}

/** Keyboard-friendly reorder: shift one place up (-1) or down (+1). */
export function nudge(list: DashboardItem[], id: string, delta: -1 | 1): DashboardItem[] {
  const from = list.findIndex((i) => i.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return list
  const next = [...list]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

export function addWidget(list: DashboardItem[], type: WidgetType, newId: string): DashboardItem[] {
  if (list.length >= MAX_WIDGETS) return list
  return [...list, { id: newId, type, size: WIDGETS[type].defaultSize }]
}

export const removeWidget = (list: DashboardItem[], id: string): DashboardItem[] => list.filter((i) => i.id !== id)

export const setSize = (list: DashboardItem[], id: string, size: WidgetSize): DashboardItem[] =>
  list.map((i) => (i.id === id ? { ...i, size } : i))

/** Widgets you can still add: each type once, except where a second copy makes sense (none yet). */
export const availableToAdd = (list: DashboardItem[]): WidgetType[] =>
  (Object.keys(WIDGETS) as WidgetType[]).filter((t) => !list.some((i) => i.type === t))

/** Repairs a stored layout: drops duplicates by id, caps the length. Unknown types stay (forward compatibility). */
export function sanitize(list: DashboardItem[]): DashboardItem[] {
  const seen = new Set<string>()
  return list.filter((i) => (seen.has(i.id) ? false : (seen.add(i.id), true))).slice(0, MAX_WIDGETS)
}
