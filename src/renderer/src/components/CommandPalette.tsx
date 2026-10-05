import { CornerDownLeft, ExternalLink, FolderPlus, House, OctagonX, Package, Play, Plug, RefreshCw, Search, Keyboard, Puzzle, Settings, Zap, type LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { MODULES, isModuleEnabled } from '@shared/modules'
import { useBindings, IS_MAC } from '@/lib/commands'
import { formatCombo } from '@shared/keybindings'
import { useEscapeKey } from '@/lib/hooks'
import { cx, errMsg, fuzzyMatch } from '@/lib/util'
import { RENDERER_MODULES } from '@/modules/registry'
import { isDevServer, usePortsStore } from '@/stores/ports-store'
import { projectLabel, useProjectsStore } from '@/stores/projects-store'
import { usePluginsStore } from '@/stores/plugins-store'
import { useActionsStore } from '@/stores/actions-store'
import { useScriptsStore } from '@/stores/scripts-store'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'

const PROJECT_JUMP_TABS = ['changes', 'tasks', 'audit'] as const

interface Item {
  id: string
  title: string
  subtitle?: string
  section: string
  icon: LucideIcon
  keywords?: string[]
  run(): void | Promise<void>
}

const MAX_RESULTS = 40

/**
 * ⌘K. One place to jump to a project, run a script, stop a port or change a
 * setting. Items come from every module, so new features show up here by
 * adding to `useItems`, not by building their own search.
 */
export function CommandPalette(): React.JSX.Element {
  const { setPalette, go, setSettings, setAddFolder, setKillTarget, view } = useUiStore()
  const bindings = useBindings()
  const kb = (id: string): string => formatCombo(bindings[id] ?? '', IS_MAC)
  const plugins = usePluginsStore((st) => st.plugins)
  const customActions = useActionsStore((st) => st.actions)
  const requestAction = useActionsStore((st) => st.request)
  const workspaces = useProjectsStore((s) => s.workspaces)
  const rescan = useProjectsStore((s) => s.rescan)
  const snapshot = usePortsStore((s) => s.snapshot)
  const enabled = useSettingsStore((s) => s.settings.enabledModules)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [scriptItems, setScriptItems] = useState<Item[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const close = (): void => setPalette(false)
  useEscapeKey(close)
  useEffect(() => input.current?.focus(), [])

  // Scripts of trusted folders, gathered once when the palette opens.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const found: Item[] = []
      for (const ws of workspaces.filter((w) => w.trusted)) {
        const lists = await Promise.allSettled(ws.projects.map((p) => window.cairix.scripts.list(p.id)))
        lists.forEach((res, i) => {
          if (res.status !== 'fulfilled') return
          const project = ws.projects[i]
          const label = projectLabel({ project, workspace: ws })
          for (const s of res.value) {
            found.push({
              id: s.id,
              title: `Run ${s.name}`,
              subtitle: label,
              section: 'Scripts',
              icon: Play,
              keywords: [s.command, s.category],
              run: async () => {
                const r = await useScriptsStore.getState().run(s.id)
                if (r) go({ kind: 'project', projectId: project.id, tab: 'scripts' })
              }
            })
          }
        })
      }
      if (!cancelled) setScriptItems(found)
    })()
    return () => {
      cancelled = true
    }
  }, [workspaces, go])

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [
      { id: 'a-add', title: 'Add folder…', subtitle: kb('folder.add'), section: 'Actions', icon: FolderPlus, keywords: ['project', 'import'], run: () => setAddFolder(true) },
      { id: 'a-shortcuts', title: 'Keyboard shortcuts…', subtitle: kb('shortcuts.open'), section: 'Actions', icon: Keyboard, keywords: ['keybindings', 'hotkeys', 'keys'], run: () => useUiStore.getState().setKeybindings(true) },
      { id: 'a-settings', title: 'Open settings', subtitle: kb('settings.open'), section: 'Actions', icon: Settings, keywords: ['theme', 'preferences', 'accent'], run: () => setSettings(true) },
      ...workspaces.map<Item>((w) => ({
        id: `a-rescan-${w.id}`,
        title: `Rescan ${w.name}`,
        subtitle: 'Find new nested projects',
        section: 'Actions',
        icon: RefreshCw,
        run: () => rescan(w.id)
      })),
      { id: 'g-home', title: 'Go to Home', subtitle: kb('nav.home'), section: 'Go to', icon: House, run: () => go({ kind: 'home' }) }
    ]
    for (const m of MODULES.filter((x) => x.scope !== 'project' && isModuleEnabled(x, enabled))) {
      const icon = RENDERER_MODULES.find((r) => r.id === m.id)?.icon ?? Plug
      const navId = `nav.${m.id}` as const
      out.push({ id: `g-${m.id}`, title: `Go to ${m.title}`, subtitle: kb(navId), section: 'Go to', icon, run: () => go({ kind: 'machine', page: m.id }) })
    }
    for (const ws of workspaces) {
      for (const project of ws.projects) {
        const label = projectLabel({ project, workspace: ws })
        out.push({
          id: `p-${project.id}`,
          title: label,
          subtitle: project.path,
          section: 'Projects',
          icon: Package,
          run: () => go({ kind: 'project', projectId: project.id, tab: 'scripts' })
        })
        {
          const reviewMod = RENDERER_MODULES.find((r) => r.id === 'review')
          const reviewManifest = MODULES.find((x) => x.id === 'review')
          if (reviewMod && reviewManifest && isModuleEnabled(reviewManifest, enabled)) {
            out.push({
              id: `p-${project.id}-review`,
              title: `Review: ${label}`,
              subtitle: project.path,
              section: 'Review',
              icon: reviewMod.icon,
              keywords: ['review', 'overview', 'ai', 'claude'],
              run: () => go({ kind: 'project', projectId: project.id, tab: 'review' })
            })
          }
        }
        for (const tab of PROJECT_JUMP_TABS) {
          const mod = RENDERER_MODULES.find((r) => r.id === tab)
          const manifest = MODULES.find((x) => x.id === tab)
          if (!mod || !manifest || !isModuleEnabled(manifest, enabled)) continue
          out.push({
            id: `p-${project.id}-${tab}`,
            title: `${mod.title}: ${label}`,
            subtitle: project.path,
            section: 'Review',
            icon: mod.icon,
            keywords: [tab, 'review', 'ai', 'claude'],
            run: () => go({ kind: 'project', projectId: project.id, tab })
          })
        }
      }
    }
    out.push(...scriptItems)
    for (const pl of plugins.filter((x) => x.state === 'running')) {
      for (const c of pl.manifest.contributes.commands) {
        out.push({ id: `plg-${pl.manifest.id}-${c.id}`, title: c.title, subtitle: pl.manifest.name, section: 'Plugins', icon: Puzzle, keywords: ['plugin'], run: () => window.cairix.plugins.runCommand(pl.manifest.id, c.id) })
      }
    }
    // Your own actions, for the project you're looking at.
    if (view.kind === 'project') {
      for (const a of customActions.filter((x) => x.scope === 'project')) {
        out.push({
          id: `act-${a.id}`,
          title: a.name,
          subtitle: 'Action on this project',
          section: 'Actions',
          icon: Zap,
          keywords: ['action', a.kind],
          run: () => requestAction(a, { scope: 'project', projectId: view.projectId })
        })
      }
    }
    for (const e of snapshot?.entries ?? []) {
      if (isDevServer(e)) {
        out.push({
          id: `k-${e.pid}-${e.port}`,
          title: `Stop :${e.port}`,
          subtitle: `${e.framework ?? e.name}${e.projectName ? ` · ${e.projectName}` : ''}`,
          section: 'Ports',
          icon: OctagonX,
          keywords: ['kill', 'free', 'port', String(e.port)],
          run: () => setKillTarget(e)
        })
      }
      if (!e.protected && e.category !== 'database') {
        out.push({
          id: `o-${e.pid}-${e.port}`,
          title: `Open localhost:${e.port}`,
          subtitle: e.framework ?? e.name,
          section: 'Ports',
          icon: ExternalLink,
          run: () => window.cairix.app.openExternal(`http://localhost:${e.port}`).catch((err) => toast.error(errMsg(err)))
        })
      }
    }
    return out
  }, [workspaces, enabled, scriptItems, snapshot, go, setAddFolder, setSettings, setKillTarget, rescan, view, customActions, requestAction, bindings, plugins])

  const results = useMemo(() => {
    const q = query.trim()
    if (!q) {
      // Idle: actions and navigation first, then a short taste of everything else.
      const pick = (section: string, n: number): Item[] => items.filter((i) => i.section === section).slice(0, n)
      return [...pick('Actions', 3), ...pick('Go to', 3), ...pick('Ports', 4), ...pick('Projects', 6), ...pick('Scripts', 6)]
    }
    return items
      .map((item) => ({ item, score: fuzzyMatch([item.title, item.subtitle ?? '', ...(item.keywords ?? [])], q) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map((r) => r.item)
  }, [items, query])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  async function choose(item: Item | undefined): Promise<void> {
    if (!item) return
    close()
    try {
      await item.run()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }

  function onKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void choose(results[active])
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-black/40 px-6 pt-[14vh] animate-fade" onMouseDown={close}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()} className="no-drag w-full max-w-[620px] overflow-hidden rounded-2xl border border-cx-border bg-cx-raised shadow-2xl animate-pop">
        <div className="flex items-center gap-3 border-b border-cx-border px-4">
          <Search size={16} className="text-cx-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search projects, run a script, stop a port…"
            aria-label="Search commands"
            aria-activedescendant={results[active] ? `pal-${results[active].id}` : undefined}
            className="h-12 flex-1 bg-transparent text-lg outline-none placeholder:text-cx-faint"
          />
        </div>
        <div ref={list} role="listbox" className="max-h-[360px] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="px-3 py-8 text-center text-cx-muted">Nothing matches “{query}”.</p>}
          {results.map((item, i) => {
            const Icon = item.icon
            const newSection = i === 0 || results[i - 1].section !== item.section
            return (
              <div key={item.id}>
                {newSection && <p className="px-3 pb-1 pt-2.5 cx-label">{item.section}</p>}
                <button
                  id={`pal-${item.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onClick={() => void choose(item)}
                  onMouseMove={() => setActive(i)}
                  className={cx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-cx-accent/14')}
                >
                  <Icon size={15} className={i === active ? 'text-cx-accent-text' : 'text-cx-muted'} />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.title}</span>
                  {item.subtitle && <span className="max-w-[55%] truncate text-sm text-cx-faint">{item.subtitle}</span>}
                  {i === active && <CornerDownLeft size={13} className="shrink-0 text-cx-faint" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
