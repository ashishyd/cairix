import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { ProcessesService } from './service'

const filter = z.enum(['dev', 'all'])

export function registerProcessesHandlers(processes: ProcessesService): void {
  handle(IPC.processesScan, z.tuple([filter]), (f) => processes.scan(f))
  handle(
    IPC.processesStop,
    z.tuple([z.object({ pid: z.number().int().positive(), force: z.boolean().optional(), filter })]),
    (req) => processes.stopProcess(req)
  )
  handle(IPC.processesWatch, z.tuple([z.boolean(), filter]), (visible, f) => processes.setVisible(visible, f))
}
