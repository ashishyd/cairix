import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { LEVELS } from '@shared/learn'
import { handle } from '../../ipc'
import type { LearnService } from './service'

export function registerLearnHandlers(learn: LearnService): void {
  handle(IPC.learnList, z.tuple([]), () => learn.list())
  handle(IPC.learnGenerate, z.tuple([z.object({ topic: z.string().max(300), level: z.enum(LEVELS), another: z.boolean().optional() })]), (req) => learn.generate(req))
  handle(IPC.learnMark, z.tuple([z.string().max(64), z.boolean()]), (id, learned) => learn.mark(id, learned))
  handle(IPC.learnDelete, z.tuple([z.string().max(64)]), (id) => learn.delete(id))
}
