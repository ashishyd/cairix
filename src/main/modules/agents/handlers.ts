import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { AgentsService } from './service'

export function registerAgentsHandlers(agents: AgentsService): void {
  handle(IPC.agentsSnapshot, z.tuple([]), () => agents.snapshot())
}
