import { useEffect, useState } from 'react'
import { MODULES, isModuleEnabled } from '@shared/modules'
import type { SlowReport } from '@shared/types'
import { cx } from '@/lib/util'
import { busyCount, useAgentsStore } from '@/stores/agents-store'
import { countServers, usePortsStore } from '@/stores/ports-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useUiStore } from '@/stores/ui-store'
import { StatusDot } from './ui'

const POLL_MS = 60_000

/** The worst thing the Slow Mac check found, or null before the first answer. Polls only while visible. */
function useMacState(enabled: boolean): 'fine' | 'slow' | 'bad' | null {
  const [report, setReport] = useState<SlowReport | null>(null)
  useEffect(() => {
    if (!enabled) return
    const check = (): void => {
      if (!document.hidden) window.cairix.slowdown.diagnose().then(setReport, () => undefined)
    }
    check()
    const timer = setInterval(check, POLL_MS)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [enabled])
  if (!report) return null
  if (report.findings.some((f) => f.severity === 'high')) return 'bad'
  return report.findings.length > 0 ? 'slow' : 'fine'
}

function Pill({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title: string }): React.JSX.Element {
  return (
    <button onClick={onClick} title={title} className={cx('no-drag inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-sm text-cx-muted transition-colors hover:bg-cx-hover hover:text-cx-text')}>
      {children}
    </button>
  )
}

/** Three glanceable facts in the top bar. Each opens the page that explains it. */
export function StatusPills(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const enabledModules = useSettingsStore((s) => s.settings.enabledModules)
  const servers = countServers(usePortsStore((s) => s.snapshot))
  const working = busyCount(useAgentsStore((s) => s.snapshot))
  const slowOn = isModuleEnabled(MODULES.find((m) => m.id === 'slowdown')!, enabledModules)
  const mac = useMacState(slowOn)
  const macLabel = { fine: 'Mac is fine', slow: 'Mac is slowing', bad: 'Mac is struggling' }

  return (
    <div className="no-drag flex items-center gap-0.5">
      {slowOn && mac && (
        <Pill title="Open Slow Mac" onClick={() => go({ kind: 'machine', page: 'slowdown' })}>
          <StatusDot tone={mac === 'fine' ? 'success' : mac === 'slow' ? 'warning' : 'danger'} />
          {macLabel[mac]}
        </Pill>
      )}
      <Pill title="Open Ports" onClick={() => go({ kind: 'machine', page: 'ports' })}>
        <span className="font-medium tabular-nums text-cx-text">{servers}</span> {servers === 1 ? 'server' : 'servers'}
      </Pill>
      {working > 0 && (
        <Pill title="Open Agents" onClick={() => go({ kind: 'machine', page: 'agents' })}>
          <StatusDot tone="warning" pulse />
          {working} {working === 1 ? 'agent' : 'agents'} working
        </Pill>
      )}
    </div>
  )
}
