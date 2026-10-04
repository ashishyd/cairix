import { OctagonX } from 'lucide-react'
import { useState } from 'react'
import { errMsg, formatKb } from '@/lib/util'
import { usePortsStore } from '@/stores/ports-store'
import { toast } from '@/stores/toast-store'
import { useUiStore } from '@/stores/ui-store'
import { Button, Dialog } from './ui'

/**
 * Confirm-then-stop for a listening process. Stopping is graceful first
 * (SIGTERM, up to 3 s); if something refuses to exit, the dialog says so and
 * offers a force quit. The decision of *what* is safe to stop is made in main,
 * not here: this dialog only ever sends a pid.
 */
export function KillDialog(): React.JSX.Element | null {
  const entry = useUiStore((s) => s.killTarget)
  const setKillTarget = useUiStore((s) => s.setKillTarget)
  const refresh = usePortsStore((s) => s.refresh)
  const [phase, setPhase] = useState<'confirm' | 'stopping' | 'stuck'>('confirm')
  const [error, setError] = useState<string | null>(null)
  if (!entry) return null

  const close = (): void => {
    setKillTarget(null)
    setPhase('confirm')
    setError(null)
  }
  const looksLikeDev = entry.category === 'dev' || entry.category === 'database'

  async function stop(force: boolean): Promise<void> {
    if (!entry) return
    setPhase('stopping')
    setError(null)
    try {
      const result = await window.cairix.ports.kill({ pid: entry.pid, force })
      if (result.ok) {
        toast.success(`Stopped ${entry.framework ?? entry.name}. Port ${entry.port} is free.`)
        void refresh()
        close()
      } else if (result.stillAlive.length > 0) {
        setPhase('stuck')
      } else {
        setError(result.error ?? 'Could not stop that process.')
        setPhase('confirm')
      }
    } catch (e) {
      setError(errMsg(e))
      setPhase('confirm')
    }
  }

  return (
    <Dialog
      title={phase === 'stuck' ? 'It did not stop' : `Stop ${entry.framework ?? entry.name}?`}
      onClose={close}
      width={460}
      footer={
        <>
          <Button onClick={close} disabled={phase === 'stopping'}>
            {phase === 'stuck' ? 'Leave it' : 'Cancel'}
          </Button>
          {phase === 'stuck' ? (
            <Button variant="danger" icon={OctagonX} onClick={() => void stop(true)}>Force quit</Button>
          ) : (
            <Button variant="danger" busy={phase === 'stopping'} onClick={() => void stop(false)}>Stop</Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {phase === 'stuck' ? (
          <p className="text-cx-muted">
            It was asked to quit but is still running after 3 seconds. Force quit ends it immediately, so any unsaved work in it is lost.
          </p>
        ) : (
          <p className="text-cx-muted">
            This ends <span className="font-medium text-cx-text">{entry.name}</span> listening on port <span className="font-mono font-medium text-cx-text">{entry.port}</span>
            {entry.projectName && <> for <span className="font-medium text-cx-text">{entry.projectName}</span></>}, along with the launcher processes that started it. It frees about {formatKb(entry.treeRssKb)}.
          </p>
        )}
        {!looksLikeDev && phase !== 'stuck' && (
          <p className="rounded-lg bg-cx-warning/12 p-2.5 text-cx-warning">
            This doesn't look like a dev server. It may be an app you're using. Stop it only if you know what it is.
          </p>
        )}
        <p className="selectable truncate rounded-lg bg-cx-surface px-2.5 py-1.5 font-mono text-xs text-cx-muted" title={entry.cmdline}>
          pid {entry.pid} · {entry.cmdline}
        </p>
        {error && <p className="text-cx-danger" role="alert">{error}</p>}
      </div>
    </Dialog>
  )
}
