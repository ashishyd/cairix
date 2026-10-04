import { useEffect, useRef, useState } from 'react'
import { Code2, ExternalLink, Folder, FolderOpen, GitBranch, MoreHorizontal, ShieldAlert, ShieldCheck, SquareTerminal } from 'lucide-react'
import { canonicalizeProjectTab, isReviewGrouped, isReviewNestedId, parseReviewTab } from '@shared/review'
import type { ExternalApp } from '@shared/types'
import { Button, Chip, EmptyState, IconButton } from '@/components/ui'
import { cx, errMsg } from '@/lib/util'
import { ActionMenu } from '@/modules/actions/ActionMenu'
import { Puzzle } from 'lucide-react'
import { pluginTabs, projectTabsFor } from '@/lib/commands'
import { PluginView } from '@/modules/plugins/PluginView'
import { usePluginsStore } from '@/stores/plugins-store'
import { findProjectIn, projectLabel, useProjectsStore } from '@/stores/projects-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'

function tabMatches(tabId: string, currentTab: string): boolean {
  if (tabId === currentTab) return true
  return tabId === 'review' && (currentTab === 'review' || currentTab.startsWith('review:'))
}

const KIND_LABEL: Record<string, string> = { node: 'Node', python: 'Python', rust: 'Rust', go: 'Go', compose: 'Docker Compose', make: 'Make' }

async function openIn(app: ExternalApp, path: string): Promise<void> {
  try {
    await window.cairix.app.openInApp(app, path)
  } catch (e) {
    toast.error(errMsg(e))
  }
}

function OpenInMenu({ path }: { path: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent): void => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  const items: Array<{ app: ExternalApp; label: string; icon: typeof FolderOpen }> = [
    { app: 'finder', label: 'Show in Finder', icon: FolderOpen },
    { app: 'terminal', label: 'Open in Terminal', icon: SquareTerminal },
    { app: 'cursor', label: 'Open in Cursor', icon: ExternalLink },
    { app: 'vscode', label: 'Open in VS Code', icon: Code2 }
  ]

  return (
    <div ref={box} className="no-drag relative">
      <IconButton
        icon={MoreHorizontal}
        label="Open in…"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={cx(open && 'bg-cx-hover text-cx-text')}
      />
      {open && (
        <div role="menu" className="absolute right-0 top-8 z-40 min-w-[200px] overflow-hidden rounded-xl border border-cx-border bg-cx-raised py-1 shadow-xl animate-pop">
          {items.map(({ app, label, icon: Icon }) => (
            <button
              key={app}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void openIn(app, path)
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-cx-hover"
            >
              <Icon size={14} className="text-cx-muted" />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ProjectView({ projectId, tab }: { projectId: string; tab: string }): React.JSX.Element {
  const workspaces = useProjectsStore((s) => s.workspaces)
  const setTrust = useProjectsStore((s) => s.setTrust)
  const enabledModules = useSettingsStore((s) => s.settings.enabledModules)
  const go = useUiStore((s) => s.go)
  const ref = findProjectIn(workspaces, projectId)

  if (!ref) {
    return (
      <EmptyState icon={Folder} title="This project is no longer in Cairix" action={<Button onClick={() => go({ kind: 'home' })}>Go home</Button>}>
        Its folder may have been removed or rescanned without it.
      </EmptyState>
    )
  }

  const { project, workspace } = ref
  const plugins = usePluginsStore((st) => st.plugins)
  const onboarding = useSettingsStore((s) => s.settings.onboarding)
  const patch = useSettingsStore((s) => s.patch)
  const grouped = isReviewGrouped(enabledModules)
  const effectiveTab = canonicalizeProjectTab(tab, grouped)
  const moduleTabs = projectTabsFor(enabledModules)
  const extraTabs = pluginTabs(plugins)
  const tabs = [
    ...moduleTabs.map((t) => ({ id: t.id, title: t.title, icon: t.icon })),
    ...extraTabs.map((t) => ({ id: t.key, title: t.title, icon: Puzzle }))
  ]
  const current = tabs.find((t) => tabMatches(t.id, effectiveTab)) ?? tabs[0]
  const Tab = moduleTabs.find((t) => t.id === current?.id)?.projectTab
  const pluginTab = extraTabs.find((t) => t.key === current?.id)

  // Persist canonical tab ids (legacy changes/tasks/audit → review:…).
  useEffect(() => {
    if (effectiveTab !== tab) go({ kind: 'project', projectId, tab: effectiveTab })
  }, [effectiveTab, tab, projectId, go])

  // Record review/task milestones (standalone tabs or Review sections).
  useEffect(() => {
    const section = parseReviewTab(tab) ?? (isReviewNestedId(tab) ? tab : null)
    if ((section === 'changes' || tab === 'changes') && !onboarding.openedChanges) {
      void patch({ onboarding: { openedChanges: true } })
    } else if ((section === 'tasks' || tab === 'tasks') && !onboarding.openedTasks) {
      void patch({ onboarding: { openedTasks: true } })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, onboarding.openedChanges, onboarding.openedTasks, patch])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 px-page-x pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight">{projectLabel(ref)}</h1>
            <p className="selectable mt-0.5 truncate font-mono text-xs text-cx-faint" title={project.path}>{project.path}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {project.isMonorepoRoot && <Chip tone="accent">monorepo</Chip>}
              {project.kinds.map((k) => <Chip key={k}>{KIND_LABEL[k]}</Chip>)}
              {project.packageManager && project.kinds.includes('node') && <Chip>{project.packageManager}</Chip>}
              {project.hasGit && <Chip><GitBranch size={10} /> git</Chip>}
              {workspace.trusted ? (
                <button onClick={() => void setTrust(workspace.id, false)} title="Trusted: scripts can run. Click to revoke." className="no-drag">
                  <Chip tone="success"><ShieldCheck size={11} /> Trusted</Chip>
                </button>
              ) : (
                <button onClick={() => void setTrust(workspace.id, true)} title="Click to trust this folder and allow running its scripts" className="no-drag">
                  <Chip tone="warning"><ShieldAlert size={11} /> Not trusted — click to trust</Chip>
                </button>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <ActionMenu ctx={{ scope: 'project', projectId: project.id }} />
            <OpenInMenu path={project.path} />
          </div>
        </div>

        <nav className="mt-4 flex gap-1 overflow-x-auto border-b border-cx-border" role="tablist" aria-label="Project sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === current?.id}
              onClick={() => go({ kind: 'project', projectId, tab: t.id })}
              className={cx(
                'no-drag -mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 font-medium transition-colors',
                t.id === current?.id ? 'border-cx-accent text-cx-text' : 'border-transparent text-cx-muted hover:text-cx-text'
              )}
            >
              <t.icon size={14} />
              {t.title}
            </button>
          ))}
        </nav>
      </header>

      <div className="min-h-0 flex-1" role="tabpanel">
        {pluginTab ? <div className="h-full overflow-y-auto px-page-x py-5"><PluginView key={`${project.id}:${pluginTab.key}`} pluginId={pluginTab.pluginId} kind="tab" contribId={pluginTab.id} ctx={{ projectId: project.id }} /></div> : Tab ? <Tab key={`${project.id}:${current.id}`} project={project} workspace={workspace} /> : <EmptyState icon={Folder} title="All modules are turned off">Enable Scripts or Ports in Settings.</EmptyState>}
      </div>
    </div>
  )
}
