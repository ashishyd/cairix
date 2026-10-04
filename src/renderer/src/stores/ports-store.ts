import { create } from 'zustand'
import type { PortEntry, PortSnapshot } from '@shared/types'

interface PortsState {
  snapshot: PortSnapshot | null
  load(): Promise<void>
  refresh(): Promise<void>
}

export const usePortsStore = create<PortsState>((set) => ({
  snapshot: null,
  load: async () => {
    window.cairix.ports.onChange((snapshot) => set({ snapshot }))
    // Poll fast only while the window is actually visible; main slows down otherwise.
    const sync = (): void => void window.cairix.ports.watch(!document.hidden)
    document.addEventListener('visibilitychange', sync)
    sync()
    set({ snapshot: await window.cairix.ports.scan() })
  },
  refresh: async () => set({ snapshot: await window.cairix.ports.scan() })
}))

/** Servers a developer cares about: dev servers and databases, not macOS plumbing or random apps. */
export const isDevServer = (e: PortEntry): boolean => (e.category === 'dev' || e.category === 'database') && !e.protected

/** Number of distinct dev servers (a server on two ports counts once). */
export function countServers(snapshot: PortSnapshot | null): number {
  return new Set((snapshot?.entries ?? []).filter(isDevServer).map((e) => e.footprintPid)).size
}
