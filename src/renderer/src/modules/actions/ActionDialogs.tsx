import { Square } from 'lucide-react'
import { Button, Chip, Dialog } from '@/components/ui'
import { LogView } from '@/modules/scripts/LogView'
import { useActionsStore } from '@/stores/actions-store'
import { isActive, useScriptsStore } from '@/stores/scripts-store'

/** Confirmation (with the exact command) and live output for shell actions. */
export function ActionDialogs(): React.JSX.Element {
  const { pending, output, confirm, cancel, closeOutput } = useActionsStore()
  const run = useScriptsStore((s) => (output ? s.runs[output.runId] : undefined))
  const stop = useScriptsStore((s) => s.stop)
  return (
    <>
      {pending && (
        <Dialog
          title={`Run “${pending.action.name}”?`}
          onClose={cancel}
          width={520}
          footer={
            <>
              <Button onClick={cancel}>Cancel</Button>
              <Button variant="primary" onClick={() => void confirm()}>Run</Button>
            </>
          }
        >
          <p className="mb-2 text-cx-muted">This is exactly what will happen:</p>
          <pre className="selectable overflow-x-auto whitespace-pre-wrap rounded-lg border border-cx-border bg-cx-surface p-3 font-mono text-sm">{pending.summary}</pre>
        </Dialog>
      )}
      {output && (
        <Dialog
          title={output.name}
          onClose={closeOutput}
          width={760}
          footer={
            <>
              {run && isActive(run) && <Button icon={Square} onClick={() => void stop(run.runId)}>Stop</Button>}
              <Button variant="primary" onClick={closeOutput}>Close</Button>
            </>
          }
        >
          <div className="mb-2 flex items-center gap-2">
            {run && (isActive(run) ? <Chip tone="success">Running</Chip> : run.status === 'failed' ? <Chip tone="danger">Failed · exit {run.exitCode}</Chip> : run.status === 'stopped' ? <Chip>Stopped</Chip> : <Chip tone="success">Done</Chip>)}
          </div>
          <div className="h-[340px] rounded-lg border border-cx-border bg-cx-surface">
            <LogView key={output.runId} runId={output.runId} />
          </div>
        </Dialog>
      )}
    </>
  )
}
