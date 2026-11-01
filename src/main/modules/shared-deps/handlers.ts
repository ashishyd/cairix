import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { SharedDepsService } from './service'

export function registerSharedDepsHandlers(svc: SharedDepsService): void {
  handle(IPC.sharedDepsScan, z.tuple([]), () => svc.scan())
  handle(IPC.sharedDepsApply, z.tuple([z.array(z.string().max(300)).max(5000)]), (keys) => svc.apply(keys))
  handle(IPC.sharedDepsPrune, z.tuple([]), () => svc.prune())
}
