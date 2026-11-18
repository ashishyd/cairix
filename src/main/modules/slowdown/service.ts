import type { KillResult, ProcessEntry, SlowFixResult, SlowReport } from '@shared/types'
import { parsePs } from '../ports/parse'
import type { RunCommand } from '../ports/scanner'
import { parseCores, parseCpuLimit, parseDisk, parseLoad, parseLowPower, parseMemLevel, parseSwapUsedMb, rank } from './diagnose'

export interface SlowdownDeps {
  run: RunCommand
  /** Dev-tool process trees from a fresh scan. */
  devProcesses(): Promise<ProcessEntry[]>
  stopProcess(pid: number, force: boolean): Promise<KillResult>
  /** Running containers, or an empty list when Docker is off. */
  runningContainers(): Promise<Array<{ id: string; name: string }>>
  stopContainer(id: string): Promise<void>
}

/**
 * Finds what is slowing the Mac and fixes the two things that are safe to fix:
 * a dev process tree and a Docker container. Everything is read on demand, and
 * `fix` only trusts an id that a diagnosis taken just now still reports.
 */
export class SlowdownService {
  constructor(private readonly deps: SlowdownDeps) {}

  async diagnose(): Promise<SlowReport> {
    const sh = (file: string, args: string[]): Promise<string> => this.deps.run(file, args).catch(() => '')
    const [cores, load, mem, swap, disk, therm, power, ps, dev, containers] = await Promise.all([
      sh('sysctl', ['-n', 'hw.ncpu']),
      sh('sysctl', ['-n', 'vm.loadavg']),
      sh('sysctl', ['-n', 'kern.memorystatus_level']),
      sh('sysctl', ['-n', 'vm.swapusage']),
      sh('df', ['-k', '/']),
      sh('pmset', ['-g', 'therm']),
      sh('pmset', ['-g']),
      sh('ps', ['-A', '-o', 'pid=,ppid=,pgid=,rss=,pcpu=,etime=,command=']),
      this.deps.devProcesses().catch(() => []),
      this.deps.runningContainers().catch(() => [])
    ])
    const d = parseDisk(disk)
    const signals = {
      cores: parseCores(cores),
      load1: parseLoad(load),
      memFreePct: parseMemLevel(mem),
      swapUsedMb: parseSwapUsedMb(swap),
      diskFreeKb: d?.freeKb,
      diskTotalKb: d?.totalKb,
      cpuLimit: parseCpuLimit(therm),
      lowPower: parseLowPower(power),
      dev,
      procs: parsePs(ps),
      containers
    }
    return { at: Date.now(), cores: signals.cores, load1: signals.load1, findings: rank(signals) }
  }

  async fix(id: string, force: boolean): Promise<SlowFixResult> {
    const before = await this.diagnose()
    const finding = before.findings.find((f) => f.id === id)
    if (!finding?.fix) return { ok: false, stuck: false, message: 'That is no longer slowing your Mac, or Cairix cannot fix it for you.', report: before }
    let result: { ok: boolean; stuck: boolean; message: string }
    if (finding.fix.kind === 'stop-container') {
      await this.deps.stopContainer(id.slice('docker:'.length))
      result = { ok: true, stuck: false, message: 'Container stopped.' }
    } else {
      const k = await this.deps.stopProcess(Number(id.slice('proc:'.length)), force)
      result = k.ok
        ? { ok: true, stuck: false, message: 'Stopped.' }
        : { ok: false, stuck: k.stillAlive.length > 0, message: k.stillAlive.length ? 'It is still running after a polite stop request.' : (k.error ?? 'Could not stop it.') }
    }
    return { ...result, report: await this.diagnose() }
  }
}
