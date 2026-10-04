import { create } from 'zustand'
import type { PluginInfo, PluginsListResult } from '@shared/plugins'
import { toast } from './toast-store'

interface PluginsState extends PluginsListResult {
  loaded: boolean
  load(): Promise<void>
  reload(): Promise<void>
}

export const usePluginsStore = create<PluginsState>((set) => ({
  plugins: [],
  broken: [],
  loaded: false,
  reload: async () => set({ ...(await window.cairix.plugins.list()), loaded: true }),
  load: async () => {
    set({ ...(await window.cairix.plugins.list()), loaded: true })
    window.cairix.plugins.onChange(() => void usePluginsStore.getState().reload())
    window.cairix.plugins.onNotify((n) => toast[n.kind === 'error' ? 'error' : n.kind === 'success' ? 'success' : 'info'](`${n.plugin}: ${n.message}`))
  }
}))

export const runningPlugins = (plugins: PluginInfo[]): PluginInfo[] => plugins.filter((p) => p.state === 'running')
