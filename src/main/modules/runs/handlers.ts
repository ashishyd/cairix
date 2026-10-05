import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { RunHistoryStore } from './store'

export function registerRunsHandlers(store: RunHistoryStore): void {
  handle(IPC.runsList, z.tuple([]), () => store.list())
  handle(IPC.runsTail, z.tuple([z.string().max(80)]), (runId) => store.tail(runId))
  handle(IPC.runsClear, z.tuple([]), () => store.clear())
}
