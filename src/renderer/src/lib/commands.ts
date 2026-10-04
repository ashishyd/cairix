import { useMemo } from 'react'
import { MODULES, isModuleEnabled } from '@shared/modules'
import { ACTION_PREFIX, CAIRIX_COMMAND_EVENT, COMMANDS, effectiveBindings, formatCombo } from '@shared/keybindings'
import { contributionKey, type PluginInfo } from '@shared/plugins'
import { isReviewGrouped, isReviewNestedId, parseReviewTab, reviewTabFor, type ReviewSection } from '@shared/review'
import { RENDERER_MODULES, type RendererModule } from '@/modules/registry'
import { usePluginsStore } from '@/stores/plugins-store'
import { useActionsStore } from '@/stores/actions-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** The project tabs that are currently turned on, in order. */
export function projectTabsFor(enabled: Record<string, boolean>): RendererModule[] {
  const grouped = isReviewGrouped(enabled)
  return RENDERER_MODULES.filter((m) => {
    const manifest = MODULES.find((x) => x.id === m.id)
    if (!m.projectTab || !manifest || !isModuleEnabled(manifest, enabled)) return false
    if (grouped && m.nestUnder === 'review') return false
    if (!grouped && m.id === 'review') return false
    return true
  })
}

/** Tabs, widgets and commands contributed by plugins that are currently running. */
export function pluginTabs(plugins: PluginInfo[]): Array<{ key: string; pluginId: string; id: string; title: string }> {
  return plugins.filter((p) => p.state === 'running').flatMap((p) => p.manifest.contributes.tabs.map((t) => ({ key: contributionKey(p.manifest.id, t.id), pluginId: p.manifest.id, id: t.id, title: t.title })))
}

/** Project-scoped custom actions are the ones a shortcut can run (they need no further input). */
export function bindableActionIds(): string[] {
  return useActionsStore.getState().actions.filter((a) => a.scope === 'project').map((a) => a.id)
}

/** Current key for every command, from defaults plus the user's overrides. */
export function currentBindings(): Record<string, string> {
  return effectiveBindings(useSettingsStore.getState().settings.keybindings, bindableActionIds())
}

export function useBindings(): Record<string, string> {
  const overrides = useSettingsStore((s) => s.settings.keybindings)
  const actions = useActionsStore((s) => s.actions)
  return useMemo(() => effectiveBindings(overrides, actions.filter((a) => a.scope === 'project').map((a) => a.id)), [overrides, actions])
}

/** "⌘K" for display next to buttons and menu items; '' if unbound. */
export function useShortcut(commandId: string): string {
  return formatCombo(useBindings()[commandId] ?? '', IS_MAC)
}

function requireProject(): string | null {
  const ui = useUiStore.getState()
  if (ui.view.kind !== 'project') {
    toast.info('Open a project first, then use this shortcut.')
    return null
  }
  return ui.view.projectId
}

function goProjectTab(tab: string): void {
  const projectId = requireProject()
  if (!projectId) return
  useUiStore.getState().go({ kind: 'project', projectId, tab })
}

function enabledReviewSections(): ReviewSection[] {
  const enabled = useSettingsStore.getState().settings.enabledModules
  const nested = (['changes', 'tasks', 'audit'] as const).filter((id) => {
    const m = MODULES.find((x) => x.id === id)
    return !!m && isModuleEnabled(m, enabled)
  })
  return isReviewGrouped(enabled) ? ['overview', ...nested] : [...nested]
}

function emitPanelCommand(id: 'review.ai' | 'tasks.new'): void {
  window.dispatchEvent(new CustomEvent(CAIRIX_COMMAND_EVENT, { detail: id }))
}

function tabIndex(tabs: Array<{ id: string }>, current: string): number {
  const exact = tabs.findIndex((t) => t.id === current)
  if (exact >= 0) return exact
  if (current === 'review' || current.startsWith('review:')) {
    const review = tabs.findIndex((t) => t.id === 'review')
    if (review >= 0) return review
  }
  return 0
}

export function runCommand(id: string): void {
  const ui = useUiStore.getState()
  if (id.startsWith(ACTION_PREFIX)) {
    if (ui.view.kind !== 'project') return toast.info('Open a project first, then use this shortcut.')
    const action = useActionsStore.getState().actions.find((a) => a.id === id.slice(ACTION_PREFIX.length))
    if (action) void useActionsStore.getState().request(action, { scope: 'project', projectId: ui.view.projectId })
    return
  }
  switch (id) {
    case 'palette.open': return ui.setPalette(!ui.paletteOpen)
    case 'settings.open': return ui.setSettings(true)
    case 'shortcuts.open': return ui.setKeybindings(true)
    case 'folder.add': return ui.setAddFolder(true)
    case 'nav.home': return ui.go({ kind: 'home' })
    case 'nav.ports': return ui.go({ kind: 'machine', page: 'ports' })
    case 'nav.agents': return ui.go({ kind: 'machine', page: 'agents' })
    case 'nav.actions': return ui.go({ kind: 'machine', page: 'actions' })
    case 'nav.plugins': return ui.go({ kind: 'machine', page: 'plugins' })
    case 'project.scripts': return goProjectTab('scripts')
    case 'project.review': return goProjectTab('review')
    case 'project.changes': return goProjectTab('changes')
    case 'project.tasks': return goProjectTab('tasks')
    case 'project.audit': return goProjectTab('audit')
    case 'project.tab.next':
    case 'project.tab.prev': {
      if (ui.view.kind !== 'project') return
      const tabs = [...projectTabsFor(useSettingsStore.getState().settings.enabledModules).map((t) => ({ id: t.id })), ...pluginTabs(usePluginsStore.getState().plugins).map((t) => ({ id: t.key }))]
      if (tabs.length === 0) return
      const at = tabIndex(tabs, ui.view.tab)
      const next = tabs[(at + (id === 'project.tab.next' ? 1 : -1) + tabs.length) % tabs.length]
      return ui.go({ kind: 'project', projectId: ui.view.projectId, tab: next.id })
    }
    case 'review.section.next':
    case 'review.section.prev': {
      const projectId = requireProject()
      if (!projectId || ui.view.kind !== 'project') return
      const sections = enabledReviewSections()
      if (sections.length === 0) return
      const current = parseReviewTab(ui.view.tab) ?? (isReviewNestedId(ui.view.tab) ? ui.view.tab : null)
      const at = current ? Math.max(0, sections.indexOf(current)) : -1
      const delta = id === 'review.section.next' ? 1 : -1
      const next = sections[(at + delta + sections.length) % sections.length]
      return ui.go({ kind: 'project', projectId, tab: reviewTabFor(next) })
    }
    case 'review.ai': {
      const projectId = requireProject()
      if (!projectId) return
      ui.go({ kind: 'project', projectId, tab: 'changes' })
      // Defer so ChangesPanel is mounted before it listens.
      setTimeout(() => emitPanelCommand('review.ai'), 0)
      return
    }
    case 'tasks.new': {
      const projectId = requireProject()
      if (!projectId) return
      ui.go({ kind: 'project', projectId, tab: 'tasks' })
      setTimeout(() => emitPanelCommand('tasks.new'), 0)
      return
    }
  }
}

export { COMMANDS, CAIRIX_COMMAND_EVENT }
