import type { WifiSnapshot, WifiSpeed } from '@shared/types'
import { adviseWifi, parseAirport, parseSpeed, runTool } from './wifi'

export interface WifiDeps {
  run?(bin: string, args: string[], timeout: number): Promise<string>
  now?(): number
}

const PROFILER = '/usr/sbin/system_profiler'
const NETWORK_QUALITY = '/usr/bin/networkQuality'

/**
 * Reads the Wi-Fi link and runs Apple's speed test, then says what to change.
 * Read-only on purpose: it never changes network settings, which would need admin rights.
 */
export class WifiService {
  private readonly run: NonNullable<WifiDeps['run']>
  private readonly now: () => number
  private lastSpeed?: WifiSpeed
  private testing?: Promise<WifiSnapshot>

  constructor(deps: WifiDeps = {}) {
    this.run = deps.run ?? runTool
    this.now = deps.now ?? Date.now
  }

  async status(): Promise<WifiSnapshot> {
    const at = this.now()
    try {
      const link = parseAirport(await this.run(PROFILER, ['SPAirPortDataType', '-json'], 30_000))
      return { at, available: true, link, speed: this.lastSpeed, tips: adviseWifi(link, this.lastSpeed) }
    } catch (e) {
      const err = e as Error & { code?: string }
      const reason = err.code === 'ENOENT' ? 'Wi-Fi details need macOS.' : `Could not read Wi-Fi details. ${err.message}`
      return { at, available: false, reason, speed: this.lastSpeed, tips: [] }
    }
  }

  /** About 20 seconds and a few hundred MB of traffic. A second click joins the test already running. */
  speedTest(): Promise<WifiSnapshot> {
    this.testing ??= (async () => {
      try {
        const out = await this.run(NETWORK_QUALITY, ['-c', '-M', '20'], 60_000).catch((e: Error & { code?: string }) => {
          throw new Error(e.code === 'ENOENT' ? 'The speed test needs macOS 12 or newer.' : `The speed test failed. ${e.message}`)
        })
        this.lastSpeed = parseSpeed(out, this.now())
        return await this.status()
      } finally {
        this.testing = undefined
      }
    })()
    return this.testing
  }
}
