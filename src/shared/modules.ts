/**
 * Static description of every feature module. The renderer maps `id` to a
 * component (modules/registry.tsx) and main maps it to IPC handlers
 * (main/modules/index.ts); this file is the single list both agree on, and
 * what the Settings screen renders for enabling/disabling.
 */
export type ModuleScope = 'project' | 'machine'
export type ModuleStatus = 'ready' | 'planned'

export interface ModuleManifest {
  id: string
  title: string
  description: string
  scope: ModuleScope
  status: ModuleStatus
  defaultEnabled: boolean
}

export const MODULES: ModuleManifest[] = [
  {
    id: 'scripts',
    title: 'Scripts',
    description: 'One-click package.json, Python, Make and Compose scripts for every project.',
    scope: 'project',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'review',
    title: 'Review',
    description: 'One workspace for pending changes, agent tasks and audits — fix and learn in place.',
    scope: 'project',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'changes',
    title: 'Changes',
    description: 'Automatic review of pending git changes, with one-click fixes and learn links. Lives under Review.',
    scope: 'project',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'Give Claude or Cursor a job in plain words. It works in a safe copy and you review the result. Lives under Review.',
    scope: 'project',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'audit',
    title: 'Audit',
    description: 'On-demand code audit for bugs, security, performance, accessibility and UX. Lives under Review.',
    scope: 'project',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'ports',
    title: 'Ports',
    description: 'Every dev server listening on localhost, with memory, and a safe kill.',
    scope: 'machine',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'processes',
    title: 'Processes',
    description: 'Background processes running on your Mac, with memory and CPU, and a safe way to close them.',
    scope: 'machine',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'runs',
    title: 'Runs',
    description: 'Every script run, kept across restarts: status, duration, output, and how reliable each script is.',
    scope: 'machine',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'history',
    title: 'Commands',
    description: 'Commands you run in any terminal: how often, what they do, one-click re-run, and a never-track list.',
    scope: 'machine',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'agents',
    title: 'Agents',
    description: 'Live view of local Claude Code and Cursor agents.',
    scope: 'machine',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'actions',
    title: 'Actions',
    description: 'Your own one-click commands, links and "open in app" shortcuts for projects, ports and findings.',
    scope: 'machine',
    status: 'ready',
    defaultEnabled: true
  },
  {
    id: 'plugins',
    title: 'Plugins',
    description: 'Install sandboxed plugins that add widgets, project tabs and commands.',
    scope: 'machine',
    status: 'ready',
    defaultEnabled: true
  }
]

export function isModuleEnabled(m: ModuleManifest, enabled: Record<string, boolean>): boolean {
  return m.status === 'ready' && (enabled[m.id] ?? m.defaultEnabled)
}
