import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { HealthService } from './service'

const id = z.string().max(64)

export function registerHealthHandlers(health: HealthService): void {
  handle(IPC.healthScan, z.tuple([id]), (p) => health.scan(p))
  handle(IPC.healthDeps, z.tuple([id]), (p) => health.report(p))
  handle(IPC.healthClean, z.tuple([id, z.string().max(40)]), (p, f) => health.clean(p, f))
}
