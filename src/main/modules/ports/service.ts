import { userInfo } from 'os'
import type { KillRequest, KillResult, PortSnapshot } from '@shared/types'
import { dockerPorts } from './docker'
import { runCommand } from './exec'
import { planKill, terminateTree } from './kill'
import { CwdCache, scanPorts, type ScanResult } from './scanner'

const FAST_MS = 2000
const SLOW_MS = 10_000

export interface PortsServiceDeps {
  resolveProject(cwd: string): { id: string; name: string } | undefined
  /** Cairix-started run pids -> runId, to tag ports with the script that started them. */
  activeRunPids(): Map<number, string>
  onSnapshot(snapshot: PortSnapshot): void
  /** Tells the script runner which ports each of its runs owns. */
  onRunPorts(runId: string, ports: number[]): void
}

/**
 * Owns the scan loop. Polls fast while the Ports UI is visible and slowly
 * otherwise (the menu bar count still needs to stay roughly current), never
 * overlaps scans, and serialises kills against scans.
 */
export class PortsService {
  private cwdCache = new CwdCache()
  private timer?: NodeJS.Timeout
  private visible = false
  private running?: Promise<ScanResult>
  private last?: ScanResult
  private stopped = false

  constructor(private readonly deps: PortsServiceDeps) {}

  start(): void {
    this.stopped = false
    void this.loop()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
  }

  setVisible(visible: boolean): void {
    const changed = visible !== this.visible
    this.visible = visible
    if (changed && !this.stopped) {
      if (this.timer) clearTimeout(this.timer)
      void this.loop() // refresh immediately when the UI appears
    }
  }

  snapshot(): PortSnapshot | undefined {
    return this.last?.snapshot
  }

  /** One scan, shared by concurrent callers. */
  scanNow(): Promise<ScanResult> {
    this.running ??= this.doScan().finally(() => {
      this.running = undefined
    })
    return this.running
  }

  async kill(req: KillRequest): Promise<KillResult> {
    const signal = req.force ? 'SIGKILL' : 'SIGTERM'
    // Always plan from a fresh scan: the renderer's copy may be stale, and we
    // only ever signal pids we just saw listening.
    const fresh = await this.scanNow()
    const entry = fresh.snapshot.entries.find((e) => e.pid === req.pid)
    const plan = planKill(entry, fresh.children, fresh.byPid, fresh.selfPids)
    if (!plan.ok) return { ok: false, signal, signalled: [], stillAlive: [], error: plan.error }
    const result = await terminateTree(plan.targets, !!req.force)
    void this.scanNow().then((r) => this.publish(r))
    return result
  }

  private async loop(): Promise<void> {
    if (this.stopped) return
    try {
      this.publish(await this.scanNow())
    } catch {
      /* a failed scan is reported inside the snapshot; keep polling */
    }
    if (!this.stopped) this.timer = setTimeout(() => void this.loop(), this.visible ? FAST_MS : SLOW_MS)
  }

  private publish(result: ScanResult): void {
    this.deps.onSnapshot(result.snapshot)
    // Group listening ports by the Cairix run whose process tree owns them.
    const byRun = new Map<string, number[]>()
    for (const e of result.snapshot.entries) {
      if (e.runId) byRun.set(e.runId, [...(byRun.get(e.runId) ?? []), e.port])
    }
    for (const runId of new Set([...byRun.keys(), ...this.deps.activeRunPids().values()])) {
      this.deps.onRunPorts(runId, byRun.get(runId) ?? [])
    }
  }

  private async doScan(): Promise<ScanResult> {
    const runPids = this.deps.activeRunPids()
    const result = await scanPorts(
      {
        run: runCommand,
        currentUser: userInfo().username,
        selfPid: process.pid,
        resolveProject: this.deps.resolveProject,
        dockerPorts,
        runForAncestors: (chain) => {
          for (const pid of chain) {
            const runId = runPids.get(pid)
            if (runId) return runId
          }
          return undefined
        }
      },
      this.cwdCache
    )
    this.last = result
    return result
  }
}
