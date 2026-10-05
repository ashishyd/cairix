import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { EnvService } from './service'

const id = z.string().max(64)
const file = z.string().max(120)
const key = z.string().max(200)

export function registerEnvHandlers(env: EnvService): void {
  handle(IPC.envList, z.tuple([id]), (p) => env.list(p))
  handle(IPC.envReveal, z.tuple([id, file, key]), (p, f, k) => env.reveal(p, f, k))
  handle(IPC.envSet, z.tuple([id, file, key, z.string().max(8192)]), (p, f, k, v) => env.set(p, f, k, v))
  handle(IPC.envRemove, z.tuple([id, file, key]), (p, f, k) => env.remove(p, f, k))
  handle(IPC.envCreate, z.tuple([id, file, file]), (p, f, t) => env.create(p, f, t))
  handle(IPC.envAddMissing, z.tuple([id, file]), (p, f) => env.addMissing(p, f))
}
