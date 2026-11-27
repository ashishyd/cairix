import { useEffect } from 'react'
import { matchEvent } from '@shared/keybindings'
import { currentBindings, IS_MAC, runCommand } from './lib/commands'
import { MODULES, isModuleEnabled } from '@shared/modules'
import { AddFolderDialog } from './components/AddFolderDialog'
import { BrandLogo } from './components/BrandLogo'
import { CommandPalette } from './components/CommandPalette'
import { KillDialog } from './components/KillDialog'
import { KeybindingsDialog } from './components/KeybindingsDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { LivePanel } from './components/LivePanel'
import { Pulse } from './components/Pulse'
import { navGroupOf, Sidebar } from './components/Sidebar'
import { StatusPills } from './components/StatusPills'
import { Toasts } from './components/Toasts'
import { EmptyState, Kbd, Skeleton } from './components/ui'
import { errMsg } from './lib/util'
import { RENDERER_MODULES } from './modules/registry'
import { ActionDialogs } from './modules/actions/ActionDialogs'
import { useActionsStore } from './stores/actions-store'
import { usePluginsStore } from './stores/plugins-store'
import { useAgentsStore } from './stores/agents-store'
import { useHistoryStore } from './stores/history-store'
import { useRunsStore } from './stores/runs-store'
import { useProcessesStore } from './stores/processes-store'
import { usePortsStore } from './stores/ports-store'
import { useProjectsStore } from './stores/projects-store'
import { useScriptsStore } from './stores/scripts-store'
import { useSettingsStore } from './stores/settings-store'
import { toast } from './stores/toast-store'
import { useUiStore } from './stores/ui-store'
import { HomeView } from './views/HomeView'
import { ProjectView } from './views/ProjectView'
import { Plug, Search } from 'lucide-react'
import { useShortcut } from './lib/commands'

function BootSplash(): React.JSX.Element {
  return (
    <div className="flex h-full">
      <aside className="sidebar-bg flex w-64 shrink-0 flex-col border-r border-cx-border/50 px-4 pt-12">
        <div className="space-y-2 px-1">
          <Skeleton rows={1} className="opacity-60" />
          <Skeleton rows={3} className="mt-6 opacity-40" />
          <Skeleton rows={4} className="mt-6 opacity-40" />
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 bg-cx-bg animate-fade">
        <BrandLogo size={48} />
        <div className="text-center">
          <p className="text-lg font-semibold tracking-tight">Cairix</p>
          <p className="mt-1 text-cx-muted">Starting…</p>
        </div>
      </main>
    </div>
  )
}

function TopBar(): React.JSX.Element {
  const view = useUiStore((s) => s.view)
  const setPalette = useUiStore((s) => s.setPalette)
  const kPalette = useShortcut('palette.open')
  // The project page draws its own title and path, so the bar only names Home and machine pages.
  const crumb = view.kind === 'project' ? null : view.kind === 'home' ? ['Cairix', 'Today'] : [navGroupOf(view.page), MODULES.find((m) => m.id === view.page)?.title ?? '']
  return (
    <div className="drag flex h-[52px] shrink-0 items-center gap-3 border-b border-cx-border/60 px-4">
      <div className="min-w-0 flex-1 basis-0 text-sm text-cx-muted">
        {crumb && (
          <span className="block truncate">
            {crumb[0]} <span aria-hidden="true">›</span> <b className="font-semibold text-cx-text">{crumb[1]}</b>
          </span>
        )}
      </div>
      <button
        onClick={() => setPalette(true)}
        className="no-drag flex h-8 w-[min(440px,26%)] shrink-0 items-center gap-2 rounded-lg border border-cx-border bg-cx-raised px-3 text-left text-cx-faint transition-colors hover:border-cx-accent/60"
      >
        <Search size={14} />
        <span className="min-w-0 flex-1 truncate">Jump to anything, run a script, or ask Claude</span>
        {kPalette && <Kbd>{kPalette}</Kbd>}
      </button>
      <div className="flex min-w-0 flex-1 basis-0 justify-end">
        <StatusPills />
      </div>
    </div>
  )
}

function Content(): React.JSX.Element {
  const view = useUiStore((s) => s.view)
  const enabled = useSettingsStore((s) => s.settings.enabledModules)

  if (view.kind === 'project') return <ProjectView projectId={view.projectId} tab={view.tab} />
  if (view.kind === 'machine') {
    const manifest = MODULES.find((m) => m.id === view.page)
    const Page = RENDERER_MODULES.find((m) => m.id === view.page)?.machinePage
    if (Page && manifest && isModuleEnabled(manifest, enabled)) return <Page />
    return <EmptyState icon={Plug} title="This page is turned off">Enable it under Settings → Modules.</EmptyState>
  }
  return <HomeView />
}

export default function App(): React.JSX.Element {
  const { settings, loaded } = useSettingsStore()
  const { view, paletteOpen, settingsOpen, addFolderOpen, keybindingsOpen } = useUiStore()
  const projectsLoaded = useProjectsStore((s) => s.loaded)

  // Load everything once; each store also subscribes to live updates from main.
  useEffect(() => {
    useProcessesStore.getState().load()
    void Promise.all([
      useSettingsStore.getState().load(),
      useProjectsStore.getState().load(),
      useScriptsStore.getState().load(),
      usePortsStore.getState().load(),
      useAgentsStore.getState().load(),
      useActionsStore.getState().load(),
      useHistoryStore.getState().load(),
      useRunsStore.getState().load(),
      usePluginsStore.getState().load()
    ]).catch((e) => toast.error(`Could not start: ${errMsg(e)}`))
    const offPalette = window.cairix.app.onOpenPalette(() => useUiStore.getState().setPalette(true))
    // Clicking a notification lands on whatever it was about.
    const offNavigate = window.cairix.app.onNavigate((target) => useUiStore.getState().go(target))
    return () => {
      offPalette()
      offNavigate()
    }
  }, [])

  // Settings that are pure CSS are applied as attributes on <html>.
  useEffect(() => {
    const root = document.documentElement
    root.dataset.accent = settings.accent
    root.dataset.density = settings.density
    root.dataset.vibrancy = settings.vibrancy ? 'on' : 'off'
    root.style.setProperty('--cx-font-size', `${settings.fontSize}px`)
  }, [settings.accent, settings.density, settings.vibrancy, settings.fontSize])

  // One handler for every shortcut. The bindings are read at event time so edits apply instantly.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useUiStore.getState().recordingKey) return
      const id = matchEvent(currentBindings(), e, IS_MAC)
      if (!id) return
      e.preventDefault()
      runCommand(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded || !projectsLoaded) return <BootSplash />

  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col bg-cx-bg">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <main className={view.kind === 'project' ? 'min-w-0 flex-1 overflow-hidden' : 'min-w-0 flex-1 overflow-y-auto'}>
            <Content />
          </main>
          {settings.livePanel && <LivePanel />}
        </div>
        {settings.pulse && <Pulse />}
      </div>

      {paletteOpen && <CommandPalette />}
      {settingsOpen && <SettingsDialog />}
      {addFolderOpen && <AddFolderDialog />}
      {keybindingsOpen && <KeybindingsDialog />}
      <KillDialog />
      <ActionDialogs />
      <Toasts />
    </div>
  )
}
