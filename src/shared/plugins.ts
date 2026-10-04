/**
 * Plugin SDK contracts shared by main, the UI and (as documentation) plugin authors.
 *
 * A plugin is a folder with `cairix-plugin.json` and one JavaScript file. Its
 * code runs in an isolated, sandboxed window with no Node, filesystem or
 * network access; everything it can do goes through the permission-checked
 * `cairix` API. Its UI is a declarative tree (below) that Cairix validates and
 * draws itself: plugins never inject HTML or script into the app.
 */

export const API_VERSION = 1
export const MANIFEST_FILE = 'cairix-plugin.json'

export const SIMPLE_PERMISSIONS = {
  'projects.read': 'See your projects (names and folders)',
  'ports.read': 'See which dev servers are listening (ports, names, memory)',
  'agents.read': 'See which Claude/Cursor agents are running',
  storage: 'Keep its own small data store',
  notify: 'Show notifications inside Cairix',
  openUrl: 'Open https links in your browser'
} as const

export type SimplePermission = keyof typeof SIMPLE_PERMISSIONS
/** `network:api.github.com` or `network:*.example.com` */
export type Permission = SimplePermission | `network:${string}`

export function describePermission(p: string): string {
  if (p in SIMPLE_PERMISSIONS) return SIMPLE_PERMISSIONS[p as SimplePermission]
  if (p.startsWith('network:')) return `Contact ${p.slice(8)} over the internet`
  return p
}

export interface PluginContribution {
  id: string
  title: string
  description?: string
}

export interface PluginManifest {
  apiVersion: number
  id: string
  name: string
  version: string
  description?: string
  author?: string
  main: string
  permissions: string[]
  contributes: {
    commands: PluginContribution[]
    widgets: Array<PluginContribution & { size?: 'half' | 'full' }>
    tabs: PluginContribution[]
  }
}

export type PluginState = 'disabled' | 'starting' | 'running' | 'error'

/** What the UI knows about an installed plugin. */
export interface PluginInfo {
  manifest: PluginManifest
  enabled: boolean
  state: PluginState
  error?: string
  /** True when the manifest asks for permissions the user has not approved (after an update). */
  needsApproval: boolean
  granted: string[]
}

// ───────────────────────── declarative UI ─────────────────────────

export type UiTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export interface UiListItem {
  title: string
  subtitle?: string
  badge?: string
  tone?: UiTone
  /** Name of an action the plugin registered; invoked when the row is clicked. */
  action?: string
  payload?: string
}

export type UiNode =
  | { type: 'text'; text: string; tone?: UiTone; muted?: boolean }
  | { type: 'heading'; text: string }
  | { type: 'metric'; label: string; value: string; sub?: string }
  | { type: 'list'; items: UiListItem[]; empty?: string }
  | { type: 'button'; label: string; action: string; payload?: string; variant?: 'primary' | 'secondary' }
  | { type: 'stack'; children: UiNode[]; direction?: 'column' | 'row' }
  | { type: 'progress'; value: number; label?: string }
  | { type: 'link'; text: string; url: string }
  | { type: 'badge'; text: string; tone?: UiTone }

export type ContributionKind = 'widget' | 'tab'

export interface RenderContext {
  projectId?: string
}

/** Id used for a plugin contribution in the dashboard, tabs and palette. */
export const contributionKey = (pluginId: string, id: string): string => `plugin:${pluginId}:${id}`
export function parseContributionKey(key: string): { pluginId: string; id: string } | null {
  const m = key.match(/^plugin:([a-z0-9.-]+):([a-z0-9-]+)$/)
  return m ? { pluginId: m[1], id: m[2] } : null
}

export interface PluginsListResult {
  plugins: PluginInfo[]
  /** Folders in the plugins directory that could not be loaded, so the user can see why. */
  broken: Array<{ folder: string; error: string }>
}

export interface PluginNotification {
  plugin: string
  message: string
  kind: 'info' | 'success' | 'error'
}
