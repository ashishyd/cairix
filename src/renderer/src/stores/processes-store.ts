import { create } from 'zustand'
import type { ProcessSnapshot } from '@shared/types'
import { errMsg } from '@/lib/util'
import { toast } from './toast-store'

type Filter = ProcessSnapshot['filter']

interface ProcessesState {
  snapshot: ProcessSnapshot | null
  load(): void
  refresh(filter: Filter): Promise<void>
}

export const useProcessesStore = create<ProcessesState>((set) => ({
  snapshot: null,
  load: () => {
    window.cairix.processes.onChange((snapshot) => set({ snapshot }))
  },
  refresh: async (filter) => {
    try {
      set({ snapshot: await window.cairix.processes.scan(filter) })
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
}))
