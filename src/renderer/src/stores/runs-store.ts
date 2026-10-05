import { create } from 'zustand'
import type { RunRecord } from '@shared/types'
import { errMsg } from '@/lib/util'
import { toast } from './toast-store'

interface RunsState {
  records: RunRecord[]
  loaded: boolean
  load(): Promise<void>
  clear(): Promise<void>
}

export const useRunsStore = create<RunsState>((set) => ({
  records: [],
  loaded: false,
  load: async () => {
    window.cairix.runs.onChange((records) => set({ records }))
    set({ records: await window.cairix.runs.list(), loaded: true })
  },
  clear: async () => {
    try {
      await window.cairix.runs.clear()
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
}))
