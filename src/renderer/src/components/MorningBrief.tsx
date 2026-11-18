import { Coffee, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { buildBrief } from '@shared/brief'
import type { FlightEvent, GitState } from '@shared/types'
import { Button, IconButton, InlineAlert } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { useAgentsStore } from '@/stores/agents-store'
import { toast } from '@/stores/toast-store'

/** Projects whose brief was dismissed this session. Not saved: a new day, a new brief. */
const dismissed = new Set<string>()

/** On opening a project: where you left off, what failed, which agents are still here. */
export function MorningBrief({ projectId, hasGit, trusted, isNode }: { projectId: string; hasGit: boolean; trusted: boolean; isNode: boolean }): React.JSX.Element | null {
  const sessions = useAgentsStore((s) => s.snapshot?.sessions)
  const [git, setGit] = useState<GitState>()
  const [events, setEvents] = useState<FlightEvent[]>([])
  const [hidden, setHidden] = useState(dismissed.has(projectId))
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    setHidden(dismissed.has(projectId))
    setGit(undefined)
    // Each source is optional: a failure just means less in the brief.
    if (hasGit && trusted) window.cairix.git.state(projectId).then(setGit, () => undefined)
    window.cairix.flight.list().then((all) => setEvents(all.filter((e) => e.projectId === projectId)), () => undefined)
  }, [projectId, hasGit, trusted])

  const items = useMemo(() => buildBrief({ git, events, sessions: (sessions ?? []).filter((s) => s.projectId === projectId), now: Date.now() }), [git, events, sessions, projectId])
  if (hidden || items.length === 0) return null

  const checkDeps = async (): Promise<void> => {
    setChecking(true)
    try {
      const r = await window.cairix.health.deps(projectId)
      if (r.error) toast.error(r.error)
      else toast.info(r.outdated.length ? `${r.outdated.length} outdated package${r.outdated.length === 1 ? '' : 's'}${r.outdated.some((d) => d.major) ? ', some with a new major version' : ''}. See the Health tab.` : 'All dependencies are up to date.')
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setChecking(false)
    }
  }

  return (
    <section className="mb-3 mt-3 rounded-xl border border-cx-border bg-cx-raised px-4 py-3" aria-label="Where you left off">
      <div className="flex items-center gap-2">
        <Coffee size={14} className="text-cx-muted" aria-hidden />
        <h2 className="flex-1 font-medium">Where you left off</h2>
        {isNode && trusted && <Button size="sm" busy={checking} onClick={() => void checkDeps()} title="Uses the network">Check outdated</Button>}
        <IconButton icon={X} label="Dismiss until next launch" onClick={() => { dismissed.add(projectId); setHidden(true) }} />
      </div>
      <div className="mt-2 space-y-1.5">
        {items.map((it, n) => <InlineAlert key={n} tone={it.tone}>{it.text}</InlineAlert>)}
      </div>
    </section>
  )
}
