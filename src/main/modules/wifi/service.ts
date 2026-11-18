import { copyFile, mkdtemp, rm, stat } from 'fs/promises'
import { tmpdir } from 'os'
import { extname, join } from 'path'
import type { WifiPlan, WifiSnapshot, WifiSpeed } from '@shared/types'
import { runClaude, type CliResult, type RunClaudeOptions } from '../changes/ai'
import { buildPlanPrompt, buildRouterPrompt, maskSecrets, parsePlan, parseRouter, planArgs, routerImageArgs } from './ai'
import type { RouterStore } from './store'
import { adviseWifi, parseAirport, parseSpeed, runTool } from './wifi'

export interface WifiDeps {
  store: Pick<RouterStore, 'get' | 'set'>
  run?(bin: string, args: string[], timeout: number): Promise<string>
  /** The user's own `claude` CLI. Tests pass a fake: real calls cost money. */
  claude?(o: RunClaudeOptions): Promise<CliResult>
  now?(): number
}

const PROFILER = '/usr/sbin/system_profiler'
const NETWORK_QUALITY = '/usr/bin/networkQuality'
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif'])
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * Reads the Wi-Fi link and runs Apple's speed test, then says what to change.
 * It never changes network or router settings: Claude writes a plan, the user carries it out.
 */
export class WifiService {
  private readonly run: NonNullable<WifiDeps['run']>
  private readonly claude: NonNullable<WifiDeps['claude']>
  private readonly now: () => number
  private lastSpeed?: WifiSpeed
  private plan?: WifiPlan
  private testing?: Promise<WifiSnapshot>
  private planning?: Promise<WifiSnapshot>

  constructor(private readonly deps: WifiDeps) {
    this.run = deps.run ?? runTool
    this.claude = deps.claude ?? runClaude
    this.now = deps.now ?? Date.now
  }

  async status(): Promise<WifiSnapshot> {
    const at = this.now()
    const extra = { speed: this.lastSpeed, router: this.deps.store.get(), plan: this.plan }
    try {
      const link = parseAirport(await this.run(PROFILER, ['SPAirPortDataType', '-json'], 30_000))
      return { at, available: true, link, tips: adviseWifi(link, this.lastSpeed), ...extra }
    } catch (e) {
      const err = e as Error & { code?: string }
      const reason = err.code === 'ENOENT' ? 'Wi-Fi details need macOS.' : `Could not read Wi-Fi details. ${err.message}`
      return { at, available: false, reason, tips: [], ...extra }
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

  /** Saves the router details once, with passwords and keys masked. Empty text forgets them. */
  async saveRouter(text: string): Promise<WifiSnapshot> {
    this.deps.store.set(maskSecrets(text.trim()))
    return this.status()
  }

  /**
   * Has Claude turn a router photo or screenshot into text. The image is copied
   * into an empty temp folder (Claude's only readable place) and deleted after.
   */
  async readRouterImage(path: string): Promise<string> {
    const ext = extname(path).toLowerCase()
    if (!IMAGE_EXT.has(ext)) throw new Error('Choose a PNG, JPEG, WebP or GIF image.')
    if ((await stat(path)).size > MAX_IMAGE_BYTES) throw new Error('That image is over 10 MB. Use a smaller screenshot.')
    const dir = await mkdtemp(join(tmpdir(), 'cairix-router-'))
    try {
      const file = `router${ext}`
      await copyFile(path, join(dir, file))
      return parseRouter(await this.claude({ prompt: buildRouterPrompt(file), cwd: dir, args: routerImageArgs(), timeoutMs: 120_000 }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

  /** One paid Claude call, only on request, only when the last speed test found something to fix. */
  aiPlan(): Promise<WifiSnapshot> {
    // Cleared in .finally, which runs after the assignment even when a check fails before any await.
    this.planning ??= this.makePlan().finally(() => (this.planning = undefined))
    return this.planning
  }

  private async makePlan(): Promise<WifiSnapshot> {
    const router = this.deps.store.get()
    if (!router) throw new Error('Add your router details first.')
    const speed = this.lastSpeed
    if (!speed) throw new Error('Run a speed test first, so Claude has measurements to work from.')
    const snap = await this.status()
    if (!snap.link?.connected) throw new Error(snap.reason ?? 'Wi-Fi is not connected.')
    if (snap.tips.every((t) => t.tone === 'success')) throw new Error('Wi-Fi looks healthy. There is nothing for Claude to speed up.')
    this.plan = parsePlan(await this.claude({ prompt: buildPlanPrompt(router, snap.link, speed, snap.tips), args: planArgs(), timeoutMs: 180_000 }), this.now())
    return { ...snap, plan: this.plan }
  }
}
