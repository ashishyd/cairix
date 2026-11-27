import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { FlightService } from './service'

export function registerFlightHandlers(f: FlightService): void {
  handle(IPC.flightList, z.tuple([]), () => f.list())
  handle(IPC.flightSinceGood, z.tuple([z.string().max(120)]), (id) => f.sinceGood(id))
}
