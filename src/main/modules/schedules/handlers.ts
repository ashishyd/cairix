import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { ScheduleDraft } from '@shared/types'
import { handle } from '../../ipc'
import type { Scheduler } from './service'
import { draftSchema, type ScheduleStore } from './store'

export interface ScheduleHandlerDeps {
  /** Throws when the script or project the schedule points at does not exist. */
  validateTarget(draft: ScheduleDraft): Promise<void>
}

export function registerSchedulesHandlers(store: ScheduleStore, scheduler: Scheduler, deps: ScheduleHandlerDeps): void {
  handle(IPC.schedulesList, z.tuple([]), () => scheduler.list())
  handle(IPC.schedulesSave, z.tuple([draftSchema]), async (d) => {
    await deps.validateTarget(d as ScheduleDraft)
    const saved = store.save(d as ScheduleDraft)
    return scheduler.list().find((s) => s.id === saved.id)
  })
  handle(IPC.schedulesDelete, z.tuple([z.string().max(64)]), (id) => store.delete(id))
  handle(IPC.schedulesRunNow, z.tuple([z.string().max(64)]), (id) => scheduler.runNow(id))
}
