import type { DepsReport, OutdatedDep, VulnSummary } from '@shared/types'
import { parseVer } from './versions'

const SEVERITY_ORDER = ['critical', 'high', 'moderate', 'low', 'info']

function isMajorBehind(current: string, latest: string): boolean {
  const a = parseVer(current)
  const b = parseVer(latest)
  return !!a && !!b && b.major > a.major
}

interface RawOutdated {
  current?: string
  wanted?: string
  latest?: string
  type?: string
  dependencyType?: string
}

/** `npm outdated --json` and `pnpm outdated --format json` share one shape. `types` maps names to dependencies/devDependencies. */
export function parseOutdated(json: string, types: Record<string, string> = {}): OutdatedDep[] {
  let raw: Record<string, RawOutdated | RawOutdated[]>
  try {
    raw = JSON.parse(json || '{}')
  } catch {
    return []
  }
  const out: OutdatedDep[] = []
  for (const [name, v] of Object.entries(raw)) {
    const e = Array.isArray(v) ? v[0] : v
    if (!e || typeof e !== 'object') continue
    const current = e.current && e.current !== 'MISSING' ? e.current : '—'
    const latest = e.latest ?? ''
    if (!latest || current === latest) continue
    out.push({
      name,
      current,
      wanted: e.wanted ?? current,
      latest,
      type: types[name] ?? e.dependencyType ?? e.type ?? 'dependencies',
      major: current !== '—' && isMajorBehind(current, latest)
    })
  }
  return out.sort((a, b) => Number(b.major) - Number(a.major) || a.name.localeCompare(b.name))
}

interface Counts {
  critical?: number
  high?: number
  moderate?: number
  low?: number
  info?: number
  total?: number
}

function summarize(counts: Counts, top: VulnSummary['top']): VulnSummary {
  const n = (x: number | undefined): number => x ?? 0
  const total = counts.total ?? n(counts.critical) + n(counts.high) + n(counts.moderate) + n(counts.low) + n(counts.info)
  top.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.name.localeCompare(b.name))
  return { total, critical: n(counts.critical), high: n(counts.high), moderate: n(counts.moderate), low: n(counts.low), top: top.slice(0, 8) }
}

/** `npm audit --json` (v7+) or `pnpm audit --json`. Returns an error string when the audit itself failed. */
export function parseAudit(json: string): { vulns?: VulnSummary; error?: string } {
  let raw: Record<string, any>
  try {
    raw = JSON.parse(json || '{}')
  } catch {
    return { error: 'The audit returned something unreadable.' }
  }
  if (raw.error) return { error: String(raw.error.summary ?? raw.error.message ?? raw.error.code ?? 'The audit could not run.').slice(0, 200) }
  const counts: Counts | undefined = raw.metadata?.vulnerabilities
  if (!counts) return { error: 'The audit returned no results.' }
  const top: VulnSummary['top'] = []
  if (raw.vulnerabilities && typeof raw.vulnerabilities === 'object') {
    for (const [name, v] of Object.entries<any>(raw.vulnerabilities)) {
      const via = Array.isArray(v.via) ? v.via.find((x: unknown) => typeof x === 'object') : undefined
      top.push({ name, severity: String(v.severity ?? 'low'), title: via?.title })
    }
  } else if (raw.advisories && typeof raw.advisories === 'object') {
    for (const a of Object.values<any>(raw.advisories)) top.push({ name: String(a.module_name ?? a.name ?? '?'), severity: String(a.severity ?? 'low'), title: a.title })
  }
  return { vulns: summarize(counts, top) }
}

export function buildReport(manager: string, outdatedJson: string, auditJson: string | null, types: Record<string, string>): DepsReport {
  const report: DepsReport = { manager, outdated: parseOutdated(outdatedJson, types), ranAt: Date.now() }
  if (auditJson !== null) {
    const a = parseAudit(auditJson)
    if (a.vulns) report.vulns = a.vulns
    if (a.error) report.vulnError = a.error
  }
  return report
}
