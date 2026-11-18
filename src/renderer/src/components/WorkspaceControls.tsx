import { Play, Power } from 'lucide-react'
import { useState } from 'react'
import { bootWorkspace, parkPlan, parkWorkspace, type ParkPlan } from '@shared/workspace'
import { Button, Dialog } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'

/** Boot starts a project's dev scripts and stopped containers; Park stops everything of it, gently. */
export function WorkspaceControls({ projectId, trusted }: { projectId: string; trusted: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState<'boot' | 'park' | null>(null)
  const [plan, setPlan] = useState<ParkPlan | null>(null)

  const boot = async (): Promise<void> => {
    setBusy('boot')
    try {
      const r = await bootWorkspace(projectId, window.cairix)
      if (r.warnings.length) toast.info(r.warnings.join(' '))
      if (r.skipped.length) toast.error(`Not started: ${r.skipped.join(' · ')}`)
      if (r.started.length) toast.success(`Started ${r.started.join(', ')}.`)
      else if (!r.skipped.length) toast.info('Nothing to start: no dev script here, or it is already running.')
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const askPark = async (): Promise<void> => {
    setBusy('park')
    try {
      const p = await parkPlan(projectId, window.cairix)
      if (p.runs.length + p.containers.length === 0) toast.info('Nothing is running for this project.')
      else setPlan(p)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setBusy(null)
    }
  }

  const park = async (): Promise<void> => {
    if (!plan) return
    setBusy('park')
    const p = plan
    setPlan(null)
    const r = await parkWorkspace(p, window.cairix)
    if (r.failed.length) toast.error(`Could not stop: ${r.failed.join(' · ')}`)
    if (r.stopped.length) toast.success(`Stopped ${r.stopped.join(', ')}.`)
    setBusy(null)
  }

  return (
    <>
      <Button size="sm" icon={Play} busy={busy === 'boot'} disabled={!trusted || busy !== null} title={trusted ? 'Start dev scripts and stopped containers' : 'Trust this folder first'} onClick={() => void boot()}>
        Boot
      </Button>
      <Button size="sm" icon={Power} busy={busy === 'park'} disabled={busy !== null} title="Stop this project's runs and containers" onClick={() => void askPark()}>
        Park
      </Button>
      {plan && (
        <Dialog
          title="Park this project?"
          onClose={() => setPlan(null)}
          footer={
            <>
              <Button onClick={() => setPlan(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => void park()}>Stop {plan.runs.length + plan.containers.length}</Button>
            </>
          }
        >
          <p className="text-cx-muted">These are asked to stop gently, not force-killed:</p>
          <ul className="selectable mt-2 space-y-1 font-mono text-sm">
            {plan.runs.map((r) => <li key={r.runId}>script · {r.scriptName}</li>)}
            {plan.containers.map((c) => <li key={c.id}>container · {c.name}</li>)}
          </ul>
        </Dialog>
      )}
    </>
  )
}
