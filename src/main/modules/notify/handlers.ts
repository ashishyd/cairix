import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { Notifier } from './notifier'

export function registerNotifyHandlers(notifier: Notifier): void {
  handle(IPC.notifyTest, z.tuple([]), () => notifier.test())
}
