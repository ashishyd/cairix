import { describe, expect, it } from 'vitest'
import type { ProcessEntry } from '../src/shared/types'
import { parseCpuLimit, parseDisk, parseLoad, parseLowPower, parseMemLevel, parseSwapUsedMb, rank, type Signals } from '../src/main/modules/slowdown/diagnose'
import { SlowdownService, type SlowdownDeps } from '../src/main/modules/slowdown/service'

const GB = 1024 * 1024
const entry = (o: Partial<ProcessEntry>): ProcessEntry => ({ pid: 10, name: 'node', cmdline: 'node', rssKb: 100, treeRssKb: 100, procCount: 1, cpu: 0, uptimeSec: 1, ports: [], category: 'dev-server', ...o }) as ProcessEntry
const calm: Signals = { cores: 8, load1: 1, lowPower: false, dev: [], procs: [], containers: [] }

describe('reading macOS output', () => {
  it('parses each command', () => {
    expect(parseLoad('{ 2.10 3.20 4.00 }')).toBe(2.1)
    expect(parseMemLevel('45\n')).toBe(45)
    expect(parseMemLevel('oops')).toBeUndefined()
    expect(parseSwapUsedMb('total = 2048.00M  used = 1500.50M  free = 547.50M  (encrypted)')).toBe(1500.5)
    expect(parseSwapUsedMb('used = 2.0G')).toBe(2048)
    expect(parseCpuLimit('CPU_Scheduler_Limit = 100\nCPU_Speed_Limit = 70\n')).toBe(70)
    expect(parseCpuLimit('Note: No thermal warning level has been recorded')).toBeUndefined()
    expect(parseLowPower(' lowpowermode         1\n')).toBe(true)
    expect(parseLowPower(' lowpowermode         0\n')).toBe(false)
    expect(parseDisk('Filesystem 1024-blocks Used Available Capacity\n/dev/disk3s1 500000 480000 20000 96% /')).toEqual({ freeKb: 20000, totalKb: 500000 })
    expect(parseDisk('')).toBeUndefined()
  })
})

describe('ranking causes', () => {
  it('reports nothing for a calm Mac', () => expect(rank(calm)).toEqual([]))
  it('offers a stop for a busy dev tree and ranks the worst first', () => {
    const f = rank({ ...calm, lowPower: true, dev: [entry({ pid: 1, cpu: 95 }), entry({ pid: 2, cpu: 200 })] })
    expect(f.map((x) => x.id)).toEqual(['proc:2', 'proc:1', 'lowpower'])
    expect(f[0].fix?.kind).toBe('stop-process')
    expect(f[2].fix).toBeUndefined()
  })
  it('flags a big dev tree only when memory is tight', () => {
    const big = entry({ treeRssKb: 2 * GB })
    expect(rank({ ...calm, memFreePct: 60, dev: [big] })).toEqual([])
    expect(rank({ ...calm, memFreePct: 20, dev: [big] }).map((x) => x.id)).toEqual(['proc:10', 'memory'])
  })
  it('offers containers to stop only when memory is tight, capped at five', () => {
    const containers = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: `c${i}` }))
    expect(rank({ ...calm, containers }).length).toBe(0)
    const f = rank({ ...calm, memFreePct: 10, containers })
    expect(f.filter((x) => x.fix?.kind === 'stop-container')).toHaveLength(5)
    expect(f.find((x) => x.id === 'memory')?.severity).toBe('high')
  })
  it('gives advice only for disk, heat, Spotlight and installed apps', () => {
    const procs = [
      { pid: 5, ppid: 1, pgid: 5, rssKb: 10, cpu: 60, uptimeSec: 1, command: '/System/Library/mds_stores' },
      { pid: 6, ppid: 1, pgid: 6, rssKb: 10, cpu: 120, uptimeSec: 1, command: '/Applications/Slack.app/Contents/MacOS/Slack' }
    ]
    const f = rank({ ...calm, diskFreeKb: 4 * GB, diskTotalKb: 500 * GB, cpuLimit: 60, procs })
    expect(f.map((x) => x.id).sort()).toEqual(['app:Slack', 'disk', 'spotlight', 'thermal'])
    expect(f.every((x) => !x.fix)).toBe(true)
    expect(f.find((x) => x.id === 'disk')?.severity).toBe('high')
  })
})

function fake(dev: ProcessEntry[], stop: { ok: boolean; stillAlive: number[] } = { ok: true, stillAlive: [] }) {
  const calls: string[] = []
  const deps: SlowdownDeps = {
    run: async (file, args) => (file === 'sysctl' && args[1] === 'hw.ncpu' ? '8\n' : ''),
    devProcesses: async () => dev,
    stopProcess: async (pid, force) => {
      calls.push(`stop:${pid}:${force}`)
      return { ok: stop.ok, signal: force ? 'SIGKILL' : 'SIGTERM', signalled: [pid], stillAlive: stop.stillAlive }
    },
    runningContainers: async () => [],
    stopContainer: async (id) => void calls.push(`container:${id}`)
  }
  return { svc: new SlowdownService(deps), calls }
}

describe('the slowdown service', () => {
  it('diagnoses with whatever commands answer', async () => {
    const r = await fake([entry({ pid: 7, cpu: 150 })]).svc.diagnose()
    expect(r.cores).toBe(8)
    expect(r.findings.map((f) => f.id)).toEqual(['proc:7'])
  })
  it('refuses an id the fresh diagnosis does not report', async () => {
    const { svc, calls } = fake([entry({ pid: 7, cpu: 150 })])
    expect((await svc.fix('proc:99', false)).ok).toBe(false)
    expect((await svc.fix('disk', false)).ok).toBe(false)
    expect(calls).toEqual([])
  })
  it('stops a reported process, and says when a polite stop did not work', async () => {
    const good = fake([entry({ pid: 7, cpu: 150 })])
    expect((await good.svc.fix('proc:7', false)).ok).toBe(true)
    expect(good.calls).toEqual(['stop:7:false'])
    const stuck = await fake([entry({ pid: 7, cpu: 150 })], { ok: false, stillAlive: [7] }).svc.fix('proc:7', false)
    expect(stuck).toMatchObject({ ok: false, stuck: true })
  })
})
