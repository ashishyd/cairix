import type { ProcessEntry, SlowFinding, SlowSeverity } from '@shared/types'
import type { Proc } from '../ports/parse'

/** Everything the ranking needs, already read from the machine. Optional means "could not read it". */
export interface Signals {
  cores: number
  load1: number
  /** macOS `kern.memorystatus_level`: percent of memory that is free or easy to reclaim. */
  memFreePct?: number
  swapUsedMb?: number
  diskFreeKb?: number
  diskTotalKb?: number
  /** `pmset -g therm` CPU_Speed_Limit; under 100 means the Mac is slowing itself down to cool off. */
  cpuLimit?: number
  lowPower: boolean
  /** Dev-tool process trees, the only processes Cairix offers to stop. */
  dev: ProcessEntry[]
  /** Every process, for advice about things Cairix will not stop. */
  procs: Proc[]
  /** Running Docker containers. */
  containers: Array<{ id: string; name: string }>
}

const GB_KB = 1024 * 1024
const CPU_BUSY = 80
const ORDER: Record<SlowSeverity, number> = { high: 0, medium: 1, low: 2 }

export const parseCores = (out: string): number => Math.max(1, parseInt(out, 10) || 1)
/** `{ 2.10 3.20 4.00 }` → 2.1 */
export const parseLoad = (out: string): number => parseFloat(out.match(/[\d.]+/)?.[0] ?? '') || 0
export const parseMemLevel = (out: string): number | undefined => (/^\s*\d+\s*$/.test(out) ? Number(out) : undefined)
/** `total = 2048.00M  used = 1500.50M  free = 547.50M` → 1500.5 */
export const parseSwapUsedMb = (out: string): number | undefined => {
  const m = out.match(/used = ([\d.]+)([MG])/)
  return m ? Number(m[1]) * (m[2] === 'G' ? 1024 : 1) : undefined
}
export const parseCpuLimit = (out: string): number | undefined => {
  const m = out.match(/CPU_Speed_Limit\s*=\s*(\d+)/)
  return m ? Number(m[1]) : undefined
}
export const parseLowPower = (out: string): boolean => /^\s*lowpowermode\s+1\b/m.test(out)
/** Second line of `df -k /`: used kilobytes are not what matters, free and total are. */
export function parseDisk(out: string): { freeKb: number; totalKb: number } | undefined {
  const cols = out.trim().split('\n')[1]?.trim().split(/\s+/)
  if (!cols || cols.length < 4) return undefined
  const totalKb = Number(cols[1])
  const freeKb = Number(cols[3])
  return totalKb > 0 && Number.isFinite(freeKb) ? { freeKb, totalKb } : undefined
}

const mb = (kb: number): string => (kb >= GB_KB ? `${(kb / GB_KB).toFixed(1)} GB` : `${Math.round(kb / 1024)} MB`)
const APP = /\/Applications\/([^/]+)\.app\//
const SPOTLIGHT = /(?:^|\/)(?:mds|mds_stores|mdworker(?:_shared)?)(?:\s|$)/

/** Turns readings into findings, worst first. Pure: no machine access, so thresholds are tested directly. */
export function rank(s: Signals): SlowFinding[] {
  const out: SlowFinding[] = []
  const memTight = (s.memFreePct !== undefined && s.memFreePct < 30) || (s.swapUsedMb ?? 0) >= 4096

  for (const e of s.dev) {
    const busy = e.cpu >= CPU_BUSY
    const heavy = memTight && e.treeRssKb >= 1.5 * GB_KB
    if (!busy && !heavy) continue
    const parts = [busy && `${Math.round(e.cpu)}% of a CPU core`, `${mb(e.treeRssKb)} of memory`].filter(Boolean)
    out.push({
      id: `proc:${e.pid}`,
      severity: e.cpu >= 150 || (heavy && e.treeRssKb >= 3 * GB_KB) ? 'high' : 'medium',
      title: `${e.name} is ${busy ? 'working hard' : 'using a lot of memory'}`,
      detail: `${e.name}${e.procCount > 1 ? ` and ${e.procCount - 1} processes it started` : ''} use ${parts.join(' and ')}${e.ports.length ? `, and listen on port ${e.ports.join(', ')}` : ''}. Stopping it frees that up; you can start it again later.`,
      fix: { kind: 'stop-process', label: 'Stop it' }
    })
  }

  if (memTight) {
    for (const c of s.containers.slice(0, 5)) {
      out.push({ id: `docker:${c.id}`, severity: 'medium', title: `Container ${c.name} is running`, detail: 'Docker keeps memory reserved for its containers even when they are idle. Stop the ones you are not using.', fix: { kind: 'stop-container', label: 'Stop container' } })
    }
    const swap = s.swapUsedMb ?? 0
    out.push({
      id: 'memory',
      severity: (s.memFreePct ?? 100) < 15 || swap >= 8192 ? 'high' : 'medium',
      title: 'Memory is nearly full',
      detail: `${s.memFreePct !== undefined ? `${s.memFreePct}% is free` : 'Memory is tight'}${swap ? ` and ${(swap / 1024).toFixed(1)} GB is spilling to disk` : ''}, which makes everything slower. Quit apps you are not using; the biggest are listed here.`
    })
  }

  if (s.diskFreeKb !== undefined && s.diskTotalKb) {
    const pct = (s.diskFreeKb / s.diskTotalKb) * 100
    if (pct < 10 || s.diskFreeKb < 15 * GB_KB) {
      out.push({ id: 'disk', severity: s.diskFreeKb < 5 * GB_KB ? 'high' : 'medium', title: 'The disk is almost full', detail: `Only ${mb(s.diskFreeKb)} is free (${Math.round(pct)}%). A full disk slows the whole Mac. The Health page shows which project folders take the most space, and Shared deps can free some.` })
    }
  }

  if (s.cpuLimit !== undefined && s.cpuLimit < 100) {
    out.push({ id: 'thermal', severity: s.cpuLimit < 70 ? 'high' : 'medium', title: 'The Mac is slowing itself down to cool off', detail: `The CPU is limited to ${s.cpuLimit}% speed because it is hot. Move it somewhere with airflow, off soft surfaces, and stop heavy work for a few minutes.` })
  }

  const spotlight = s.procs.filter((p) => SPOTLIGHT.test(p.command)).reduce((a, p) => a + p.cpu, 0)
  if (spotlight >= 50) out.push({ id: 'spotlight', severity: 'medium', title: 'Spotlight is indexing files', detail: `Search indexing uses ${Math.round(spotlight)}% of a CPU core. It finishes on its own, usually within an hour; large new folders (node_modules) make it longer.` })

  // Installed apps: advice only, quitting them is the user's call.
  const apps = new Map<string, { cpu: number; rssKb: number }>()
  for (const p of s.procs) {
    const name = p.command.match(APP)?.[1]
    if (name) apps.set(name, { cpu: (apps.get(name)?.cpu ?? 0) + p.cpu, rssKb: (apps.get(name)?.rssKb ?? 0) + p.rssKb })
  }
  for (const [name, a] of apps) {
    if (a.cpu >= CPU_BUSY || (memTight && a.rssKb >= 2 * GB_KB)) {
      out.push({ id: `app:${name}`, severity: a.cpu >= 150 ? 'high' : 'medium', title: `${name} is heavy`, detail: `${name} uses ${Math.round(a.cpu)}% of a CPU core and ${mb(a.rssKb)} of memory. Quit it from the Dock if you do not need it right now.` })
    }
  }

  if (s.lowPower) out.push({ id: 'lowpower', severity: 'low', title: 'Low Power Mode is on', detail: 'It deliberately slows the CPU to save battery. Turn it off in System Settings → Battery.' })

  return out.sort((a, b) => ORDER[a.severity] - ORDER[b.severity])
}

