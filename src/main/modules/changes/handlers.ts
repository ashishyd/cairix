import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { ChangesService } from './service'

const id = z.string().max(80)

export function registerChangesHandlers(svc: ChangesService): void {
  handle(IPC.changesGet, z.tuple([id]), (p) => svc.get(p))
  handle(IPC.changesOverview, z.tuple([]), () => svc.overview())
  handle(IPC.changesReview, z.tuple([id]), (p) => svc.review(p))
  handle(IPC.changesDismiss, z.tuple([id, id]), (p, f) => svc.dismiss(p, f))
  handle(IPC.changesFix, z.tuple([id, id]), (p, f) => svc.fix(p, f))
  handle(IPC.changesApply, z.tuple([id]), (pid) => svc.apply(pid))
  handle(IPC.changesUndo, z.tuple([id]), (pid) => svc.undo(pid))
}
