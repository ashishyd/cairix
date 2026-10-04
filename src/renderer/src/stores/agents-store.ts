import { create } from 'zustand'
import type { AgentsSnapshot } from '@shared/types'

interface AgentsState {
  snapshot: AgentsSnapshot | null
  load(): Promise<void>
  refresh(): Promise<void>
}

const POLL_MS = 4000

export const useAgentsStore = create<AgentsState>((set) => ({
  snapshot: null,
  refresh: async () => {
    try {
      set({ snapshot: await window.cairix.agents.snapshot() })
    } catch {
      /* keep the last good snapshot; the next tick retries */
    }
  },
  load: async () => {
    const refresh = useAgentsStore.getState().refresh
    await refresh()
    // Poll only while the window is visible: agent state changes in seconds, not milliseconds.
    let timer: ReturnType<typeof setInterval> | undefined
    const sync = (): void => {
      if (timer) clearInterval(timer)
      timer = document.hidden ? undefined : setInterval(() => void refresh(), POLL_MS)
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', sync)
    sync()
  }
}))

export const busyCount = (s: AgentsSnapshot | null): number => (s?.sessions ?? []).filter((x) => x.status === 'busy').length
