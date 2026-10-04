import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { TasksService } from './service'

const id = z.string().max(80)
const req = z.object({
  agent: z.enum(['claude', 'cursor']),
  mode: z.enum(['read', 'edit']),
  prompt: z.string().max(8000),
  budgetUsd: z.number().optional()
})

export function registerTasksHandlers(tasks: TasksService): void {
  handle(IPC.tasksCapabilities, z.tuple([]), () => tasks.capabilities())
  handle(IPC.tasksList, z.tuple([id]), (p) => tasks.list(p))
  handle(IPC.tasksStart, z.tuple([id, req]), (p, r) => tasks.start(p, r))
  handle(IPC.tasksCancel, z.tuple([id]), (t) => tasks.cancel(t))
  handle(IPC.tasksPropose, z.tuple([id]), (t) => tasks.propose(t))
  handle(IPC.tasksRemove, z.tuple([id]), (t) => tasks.remove(t))
}
