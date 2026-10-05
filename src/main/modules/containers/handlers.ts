import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { ContainersService } from './service'

export function registerContainersHandlers(c: ContainersService): void {
  handle(IPC.containersList, z.tuple([]), () => c.list())
  handle(IPC.containersAction, z.tuple([z.string().max(70), z.enum(['start', 'stop', 'restart'])]), (id, a) => c.action(id, a))
  handle(IPC.containersLogs, z.tuple([z.string().max(70), z.number().int().optional()]), (id, tail) => c.logs(id, tail))
}
