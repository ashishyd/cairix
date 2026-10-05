import { join } from 'path'
import { z } from 'zod'
import { redactCommand } from '@shared/redact'
import type { RunInfo, RunRecord } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'

const MAX_RUNS = 300
const MAX_TAIL = 4000

const record = z.object({
  runId: z.string(),
  scriptId: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  scriptName: z.string(),
  command: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  durationMs: z.number(),
  status: z.enum(['exited', 'failed', 'stopped']),
  exitCode: z.number().nullable().optional(),
  tail: z.string()
})
const file = z.object({ version: z.literal(1), runs: z.array(record) })
type Stored = z.infer<typeof record>

/** Terminal output as plain text: colour codes gone, `\r` progress redraws collapsed to their last state. */
export function cleanOutput(raw: string): string {
  const noAnsi = raw.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '')
  return noAnsi
    .split('\n')
    .map((line) => line.replace(/\r+$/, '').split('\r').pop() ?? '')
    .join('\n')
}

/** The end of a run's output, readable and with secrets masked, for the history view. */
export function tailOf(raw: string): string {
  const text = cleanOutput(raw)
  const tail = text.length > MAX_TAIL ? '…' + text.slice(-MAX_TAIL) : text
  return redactCommand(tail).trimEnd()
}

/**
 * Finished runs, kept across restarts. Written once per finished run (rare),
 * newest kept, oldest dropped. Output tails go through the same secret
 * masking as process command lines before touching disk.
 */
export class RunHistoryStore {
  private runs: Stored[]
  private readonly path: string

  constructor(dir: string, private readonly onChange: (records: RunRecord[]) => void = () => undefined) {
    this.path = join(dir, 'run-history.json')
    this.runs = readJson(this.path, file, () => ({ version: 1 as const, runs: [] })).runs
  }

  /** Stores a finished run. Returns false if it was already stored or is not finished. */
  record(info: RunInfo, rawLog: string): boolean {
    if (!info.endedAt || info.status === 'running' || info.status === 'stopping') return false
    if (this.runs.some((r) => r.runId === info.runId)) return false
    this.runs.unshift({
      runId: info.runId,
      scriptId: info.scriptId,
      projectId: info.projectId,
      projectName: info.projectName,
      scriptName: info.scriptName,
      command: redactCommand(info.command),
      startedAt: info.startedAt,
      endedAt: info.endedAt,
      durationMs: Math.max(0, info.endedAt - info.startedAt),
      status: info.status,
      exitCode: info.exitCode,
      tail: tailOf(rawLog)
    })
    if (this.runs.length > MAX_RUNS) this.runs.length = MAX_RUNS
    this.persist()
    return true
  }

  list(): RunRecord[] {
    return this.runs.map(({ tail: _tail, ...rest }) => rest)
  }

  tail(runId: string): string {
    return this.runs.find((r) => r.runId === runId)?.tail ?? ''
  }

  clear(): void {
    this.runs = []
    this.persist()
  }

  private persist(): void {
    writeJsonAtomic(this.path, { version: 1, runs: this.runs })
    this.onChange(this.list())
  }
}
