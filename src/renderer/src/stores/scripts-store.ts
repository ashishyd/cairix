import { create } from 'zustand'
import type { RunInfo } from '@shared/types'
import { errMsg } from '@/lib/util'
import { useSettingsStore } from './settings-store'
import { toast } from './toast-store'

interface ScriptsState {
  /** Every known run, newest data wins. */
  runs: Record<string, RunInfo>
  load(): Promise<void>
  run(scriptId: string, args?: string[]): Promise<RunInfo | undefined>
  stop(runId: string, force?: boolean): Promise<void>
}

export const isActive = (r: RunInfo): boolean => r.status === 'running' || r.status === 'stopping'

export const useScriptsStore = create<ScriptsState>((set) => ({
  runs: {},
  load: async () => {
    const list = await window.cairix.scripts.runs()
    set({ runs: Object.fromEntries(list.map((r) => [r.runId, r])) })
    window.cairix.scripts.onRunEvent((run) => set((s) => ({ runs: { ...s.runs, [run.runId]: run } })))
  },
  run: async (scriptId, args) => {
    try {
      const run = await window.cairix.scripts.run({ scriptId, args })
      set((s) => ({ runs: { ...s.runs, [run.runId]: run } }))
      if (!useSettingsStore.getState().settings.onboarding.ranScript) {
        void useSettingsStore.getState().patch({ onboarding: { ranScript: true } })
      }
      return run
    } catch (e) {
      toast.error(errMsg(e))
      return undefined
    }
  },
  stop: async (runId, force) => {
    try {
      await window.cairix.scripts.stop(runId, force)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
}))

/** The most relevant run for a script: the active one, else the most recent. */
export function runForScript(runs: Record<string, RunInfo>, scriptId: string): RunInfo | undefined {
  let best: RunInfo | undefined
  for (const r of Object.values(runs)) {
    if (r.scriptId !== scriptId) continue
    if (!best || (isActive(r) && !isActive(best)) || (isActive(r) === isActive(best) && r.startedAt > best.startedAt)) {
      best = r
    }
  }
  return best
}
