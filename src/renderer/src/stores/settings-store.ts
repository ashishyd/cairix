import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings, type SettingsPatch } from '@shared/settings-types'
import { errMsg } from '@/lib/util'
import { toast } from './toast-store'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load(): Promise<void>
  patch(patch: SettingsPatch): Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  load: async () => {
    const settings = await window.cairix.settings.get()
    set({ settings, loaded: true })
    window.cairix.settings.onChange((s) => set({ settings: s }))
  },
  patch: async (patch) => {
    // Optimistic: the UI (theme, accent) should react instantly.
    const before = get().settings
    const next: Settings = {
      ...before,
      ...patch,
      enabledModules: { ...before.enabledModules, ...patch.enabledModules },
      onboarding: patch.onboarding ? { ...before.onboarding, ...patch.onboarding } : before.onboarding
    }
    set({ settings: next })
    try {
      set({ settings: await window.cairix.settings.set(patch) })
    } catch (e) {
      set({ settings: before })
      toast.error(errMsg(e))
    }
  }
}))
