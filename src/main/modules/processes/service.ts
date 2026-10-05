import { userInfo } from 'os'
import type { KillResult, PortEntry, ProcessSnapshot, StopProcessRequest } from '@shared/types'
import { runCommand } from '../ports/exec'
import { terminateTree } from '../ports/kill'
import { planStop, scanProcesses, type ProcessFilter, type ProcessScan } from './scan'

const POLL_MS = 3000

export interface ProcessesServiceDeps {
  ports(): PortEntry[]
  /** Cairix-started run pids -> runId. */
  activeRunPids(): Map<number, string>
  onSnapshot(snapshot: ProcessSnapshot): void
}

/**
 * Polls `ps` only while the Processes page is visible: unlike ports there is no
 * menu-bar count to keep fresh, so a hidden window costs nothing.
 */
export class ProcessesService {
  private timer?: NodeJS.Timeout
  private visible = false
  private filter: ProcessFilter = 'dev'

  constructor(private readonly deps: ProcessesServiceDeps) {}

  setVisible(visible: boolean, filter: ProcessFilter): void {
    this.visible = visible
    this.filter = filter
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    if (visible) void this.loop()
  }

  stop(): void {
    this.visible = false
    if (this.timer) clearTimeout(this.timer)
  }

  async scan(filter: ProcessFilter): Promise<ProcessSnapshot> {
    this.filter = filter
    return toSnapshot(await this.scanNow(filter), filter)
  }

  async stopProcess(req: StopProcessRequest): Promise<KillResult> {
    const signal = req.force ? 'SIGKILL' : 'SIGTERM'
    // Re-derive the target from a fresh scan of the same view the user was looking at.
    const fresh = await this.scanNow(req.filter)
    const plan = planStop(fresh, req.pid)
    if (!plan.ok) return { ok: false, signal, signalled: [], stillAlive: [], error: plan.error }
    const result = await terminateTree(plan.targets, !!req.force)
    void this.scanNow(this.filter).then((s) => this.deps.onSnapshot(toSnapshot(s, this.filter)))
    return result
  }

  private scanNow(filter: ProcessFilter): Promise<ProcessScan> {
    const runPids = this.deps.activeRunPids()
    return scanProcesses(
      {
        run: runCommand,
        currentUser: userInfo().username,
        selfPid: process.pid,
        ports: this.deps.ports,
        runForAncestors: (chain) => {
          for (const pid of chain) {
            const id = runPids.get(pid)
            if (id) return id
          }
          return undefined
        }
      },
      filter
    )
  }

  private async loop(): Promise<void> {
    if (!this.visible) return
    try {
      this.deps.onSnapshot(toSnapshot(await this.scanNow(this.filter), this.filter))
    } catch (e) {
      this.deps.onSnapshot({ at: Date.now(), filter: this.filter, entries: [], total: 0, error: e instanceof Error ? e.message : String(e) })
    }
    if (this.visible) this.timer = setTimeout(() => void this.loop(), POLL_MS)
  }
}

function toSnapshot(scan: ProcessScan, filter: ProcessFilter): ProcessSnapshot {
  return { at: Date.now(), filter, entries: scan.entries, total: scan.total }
}
