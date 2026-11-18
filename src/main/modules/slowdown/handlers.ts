import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { SlowdownService } from './service'

export function registerSlowdownHandlers(slowdown: SlowdownService): void {
  handle(IPC.slowdownDiagnose, z.tuple([]), () => slowdown.diagnose())
  handle(IPC.slowdownFix, z.tuple([z.string().max(200), z.boolean()]), (id, force) => slowdown.fix(id, force))
}
