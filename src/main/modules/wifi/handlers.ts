import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { WifiService } from './service'

export function registerWifiHandlers(w: WifiService): void {
  handle(IPC.wifiStatus, z.tuple([]), () => w.status())
  handle(IPC.wifiSpeedTest, z.tuple([]), () => w.speedTest())
}
