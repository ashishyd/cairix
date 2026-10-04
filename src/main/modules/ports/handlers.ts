import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { PortsService } from './service'

export function registerPortsHandlers(ports: PortsService): void {
  handle(IPC.portsScan, z.tuple([]), async () => (await ports.scanNow()).snapshot)

  handle(
    IPC.portsKill,
    z.tuple([z.object({ pid: z.number().int().positive(), force: z.boolean().optional() })]),
    (req) => ports.kill(req)
  )

  handle(IPC.portsWatch, z.tuple([z.boolean()]), (visible) => {
    ports.setVisible(visible)
  })
}
