import { useEffect, useState } from 'react'
import type { FlightEvent, FlightKind } from '@shared/types'
import { cx, timeAgo } from '@/lib/util'
import { useUiStore } from '@/stores/ui-store'

const WINDOW_MS = 8 * 3600_000
const POLL_MS = 30_000
const TONE: Record<FlightKind, string> = { crash: 'bg-cx-danger', commit: 'bg-cx-success', branch: 'bg-cx-accent', deps: 'bg-cx-faint', env: 'bg-cx-warning' }

/** The last eight hours of changes along the bottom edge. Reads the flight recorder; each dot opens it. */
export function Pulse(): React.JSX.Element {
  const go = useUiStore((s) => s.go)
  const [events, setEvents] = useState<FlightEvent[] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const load = (): void => {
      if (document.hidden) return
      window.cairix.flight.list().then((e) => {
        setEvents(e)
        setNow(Date.now())
      }, () => undefined)
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [])

  const recent = (events ?? []).filter((e) => e.at >= now - WINDOW_MS)

  return (
    <footer aria-label="Pulse: what changed in the last 8 hours" className="no-drag flex h-11 shrink-0 items-center gap-3.5 border-t border-cx-border bg-cx-surface px-4">
      <button onClick={() => go({ kind: 'machine', page: 'flight' })} className="shrink-0 text-sm font-semibold hover:text-cx-accent-text">Pulse</button>
      <span className="shrink-0 text-xs text-cx-faint">8 h ago</span>
      <div className="relative h-5 min-w-0 flex-1">
        <span className="absolute inset-x-0 top-[9px] h-0.5 rounded-full bg-cx-border" />
        {recent.map((e) => (
          <button
            key={e.id}
            title={`${timeAgo(e.at, now)} · ${e.projectName}: ${e.title}`}
            aria-label={`${timeAgo(e.at, now)}, ${e.projectName}: ${e.title}`}
            onClick={() => go({ kind: 'machine', page: 'flight' })}
            style={{ left: `${Math.min(98, Math.max(0, ((e.at - (now - WINDOW_MS)) / WINDOW_MS) * 100))}%` }}
            className={cx('absolute top-[3px] h-3.5 w-3.5 -translate-x-1/2 rounded-full border-2 border-cx-surface transition-transform hover:scale-125', TONE[e.kind])}
          />
        ))}
        {events !== null && recent.length === 0 && <span className="absolute left-0 top-0 bg-cx-surface pr-2 text-xs text-cx-faint">Nothing changed in your projects in the last 8 hours.</span>}
      </div>
      <span className="shrink-0 text-xs text-cx-faint">now</span>
    </footer>
  )
}
