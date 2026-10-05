import { create } from 'zustand'
import type { HistoryRule, HistorySnapshot } from '@shared/types'
import { errMsg } from '@/lib/util'
import { useActionsStore } from './actions-store'
import { toast } from './toast-store'

interface HistoryState {
  snapshot: HistorySnapshot | null
  load(): Promise<void>
  /** Re-runs a remembered command; shows its output (or hands it to Terminal). */
  rerun(id: string, name: string, opts?: { projectId?: string; confirmed?: boolean }): Promise<void>
  ignore(rule: HistoryRule): Promise<void>
  unignore(rule: HistoryRule): Promise<void>
}

export const useHistoryStore = create<HistoryState>((set) => ({
  snapshot: null,
  load: async () => {
    window.cairix.history.onChange((snapshot) => set({ snapshot }))
    set({ snapshot: await window.cairix.history.list() })
  },
  rerun: async (id, name, opts) => {
    try {
      const result = await window.cairix.history.rerun({ id, ...opts })
      // Reuses the Actions output dialog, which is mounted for the whole app.
      if (result.runId) useActionsStore.setState({ output: { runId: result.runId, name } })
      else if (result.message) toast.success(result.message)
    } catch (e) {
      toast.error(errMsg(e))
    }
  },
  ignore: async (rule) => {
    try {
      set({ snapshot: await window.cairix.history.ignore(rule) })
    } catch (e) {
      toast.error(errMsg(e))
    }
  },
  unignore: async (rule) => {
    try {
      set({ snapshot: await window.cairix.history.unignore(rule) })
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
}))
