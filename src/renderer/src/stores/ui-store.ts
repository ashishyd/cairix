import { create } from 'zustand'
import { canonicalizeProjectTab, isReviewGrouped } from '@shared/review'
import type { PortEntry } from '@shared/types'
import { useSettingsStore } from './settings-store'

export type View =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string; tab: string }
  | { kind: 'machine'; page: string }

interface UiState {
  view: View
  paletteOpen: boolean
  settingsOpen: boolean
  addFolderOpen: boolean
  keybindingsOpen: boolean
  /** True while a shortcut is being recorded, so the global handler doesn't fire the key being captured. */
  recordingKey: boolean
  /** The port entry the user asked to stop; drives the confirm dialog from anywhere (table, palette). */
  killTarget: PortEntry | null
  /** Sidebar tree nodes the user collapsed (workspace or project ids). */
  collapsed: Set<string>
  go(view: View): void
  setPalette(open: boolean): void
  setSettings(open: boolean): void
  setAddFolder(open: boolean): void
  setKeybindings(open: boolean): void
  setRecordingKey(on: boolean): void
  setKillTarget(entry: PortEntry | null): void
  toggleCollapsed(id: string): void
}

const STORAGE_KEY = 'cairix.ui.v1'

function restore(): { view: View; collapsed: string[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    return {
      view: raw.view?.kind ? raw.view : { kind: 'home' },
      collapsed: Array.isArray(raw.collapsed) ? raw.collapsed : []
    }
  } catch {
    return { view: { kind: 'home' }, collapsed: [] }
  }
}

function persist(view: View, collapsed: Set<string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ view, collapsed: [...collapsed] }))
  } catch {
    /* storage can be unavailable; the UI just won't remember */
  }
}

const initial = restore()

export const useUiStore = create<UiState>((set, get) => ({
  view: initial.view,
  paletteOpen: false,
  settingsOpen: false,
  addFolderOpen: false,
  keybindingsOpen: false,
  recordingKey: false,
  killTarget: null,
  collapsed: new Set(initial.collapsed),
  go: (view) => {
    let next = view
    if (view.kind === 'project') {
      const enabled = useSettingsStore.getState().settings.enabledModules
      next = { ...view, tab: canonicalizeProjectTab(view.tab, isReviewGrouped(enabled)) }
    }
    set({ view: next })
    persist(next, get().collapsed)
  },
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSettings: (settingsOpen) => set({ settingsOpen }),
  setAddFolder: (addFolderOpen) => set({ addFolderOpen }),
  setKeybindings: (keybindingsOpen) => set({ keybindingsOpen }),
  setRecordingKey: (recordingKey) => set({ recordingKey }),
  setKillTarget: (killTarget) => set({ killTarget }),
  toggleCollapsed: (id) => {
    const next = new Set(get().collapsed)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set({ collapsed: next })
    persist(get().view, next)
  }
}))
