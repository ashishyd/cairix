import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { cleanOutput, RunHistoryStore, tailOf } from '../src/main/modules/runs/store'
import { formatDuration, summarizeRuns } from '../src/shared/runs'
import type { RunInfo, RunRecord } from '../src/shared/types'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-runs-')))
  dirs.push(d)
  return d
}
const info = (over: Partial<RunInfo> = {}): RunInfo => ({
  runId: 'r1', scriptId: 'p1:test', projectId: 'p1', projectName: 'web-app', scriptName: 'test', command: 'pnpm test',
  pid: 1, startedAt: 1000, endedAt: 4500, status: 'exited', exitCode: 0, ports: [], ...over
})

describe('cleaning run output', () => {
  it('drops colour codes and keeps only the last state of a progress line', () => {
    expect(cleanOutput('\x1b[31mred\x1b[0m text\r\nloading 10%\rloading 90%\rdone\r\n')).toBe('red text\ndone\n')
  })
  it('keeps the end of long output, masks secrets, and says it was cut', () => {
    const out = tailOf('x'.repeat(10_000) + '\nTOKEN=abc123 ghp_abcdefghijklmnopqrstuvwxyz0123456789\nlast line')
    expect(out.length).toBeLessThan(4200)
    expect(out.startsWith('…')).toBe(true)
    expect(out).toContain('last line')
    expect(out).not.toContain('abc123')
    expect(out).not.toContain('ghp_abcdef')
  })
})

describe('the run store', () => {
  it('keeps a finished run, with its duration and output, across restarts', () => {
    const dir = tmp()
    const s = new RunHistoryStore(dir)
    expect(s.record(info(), '\x1b[32mall passed\x1b[0m\n')).toBe(true)
    const again = new RunHistoryStore(dir)
    expect(again.list()).toEqual([expect.objectContaining({ runId: 'r1', durationMs: 3500, status: 'exited', scriptName: 'test' })])
    expect(again.tail('r1')).toBe('all passed')
    expect(again.list()[0]).not.toHaveProperty('tail')
  })
  it('stores each run once and ignores runs that are not finished', () => {
    const s = new RunHistoryStore(tmp())
    expect(s.record(info(), '')).toBe(true)
    expect(s.record(info(), '')).toBe(false)
    expect(s.record(info({ runId: 'r2', status: 'running', endedAt: undefined }), '')).toBe(false)
    expect(s.record(info({ runId: 'r3', status: 'stopping', endedAt: 5000 }), '')).toBe(false)
    expect(s.list()).toHaveLength(1)
  })
  it('lists newest first and keeps only the latest 300', () => {
    const s = new RunHistoryStore(tmp())
    for (let i = 0; i < 305; i++) s.record(info({ runId: `r${i}`, endedAt: 5000 + i }), '')
    const list = s.list()
    expect(list).toHaveLength(300)
    expect(list[0].runId).toBe('r304')
    expect(list.at(-1)!.runId).toBe('r5')
    expect(s.tail('r0')).toBe('')
  })
  it('never writes a credential from the command or output to disk', () => {
    const dir = tmp()
    const s = new RunHistoryStore(dir)
    s.record(info({ command: 'deploy --api-key sk-abcdefghijklmnopqrstuvwxyz' }), 'using DB_PASSWORD=hunter2')
    const raw = readFileSync(join(dir, 'run-history.json'), 'utf8')
    expect(raw).not.toContain('sk-abcdefghij')
    expect(raw).not.toContain('hunter2')
  })
  it('clears everything and tells listeners', () => {
    const seen: number[] = []
    const s = new RunHistoryStore(tmp(), (r) => seen.push(r.length))
    s.record(info(), '')
    s.clear()
    expect(s.list()).toEqual([])
    expect(seen).toEqual([1, 0])
  })
  it('starts empty from a corrupt file instead of failing', () => {
    const dir = tmp()
    require('fs').writeFileSync(join(dir, 'run-history.json'), '{not json')
    expect(new RunHistoryStore(dir).list()).toEqual([])
  })
})

const rec = (over: Partial<RunRecord>): RunRecord => ({ runId: 'x', scriptId: 'p1:test', projectId: 'p1', projectName: 'web-app', scriptName: 'test', command: 'pnpm test', startedAt: 0, endedAt: 0, durationMs: 1000, status: 'exited', ...over })

describe('per-script reliability', () => {
  it('counts runs, failures, success rate and average duration', () => {
    const [s] = summarizeRuns([
      rec({ runId: '1', endedAt: 1, durationMs: 1000 }),
      rec({ runId: '2', endedAt: 2, durationMs: 3000, status: 'failed' }),
      rec({ runId: '3', endedAt: 3, durationMs: 2000 }),
      rec({ runId: '4', endedAt: 4, durationMs: 99_000, status: 'stopped' })
    ])
    expect(s).toMatchObject({ runs: 4, failures: 1, lastStatus: 'stopped' })
    expect(s.successRate).toBeCloseTo(2 / 3)
    expect(s.avgMs).toBe(2000) // the stopped run does not skew the average
  })
  it('flags a script as flaky when two of its last five completed runs failed', () => {
    const runs = [1, 2, 3, 4, 5].map((i) => rec({ runId: String(i), endedAt: i, status: i === 5 || i === 3 ? 'failed' : 'exited' }))
    expect(summarizeRuns(runs)[0].flaky).toBe(true)
    expect(summarizeRuns(runs.slice(0, 2))[0].flaky).toBe(false)
  })
  it('keeps the same script name in different projects apart, most recent first', () => {
    const stats = summarizeRuns([rec({ runId: 'a', projectId: 'p1', endedAt: 1 }), rec({ runId: 'b', projectId: 'p2', projectName: 'api', endedAt: 9 })])
    expect(stats.map((s) => s.projectId)).toEqual(['p2', 'p1'])
  })
  it('treats a script that was only ever stopped as reliable, not broken', () => {
    expect(summarizeRuns([rec({ status: 'stopped' })])[0]).toMatchObject({ successRate: 1, failures: 0, flaky: false })
  })
})

describe('durations', () => {
  it('reads naturally', () => {
    expect(formatDuration(850)).toBe('850 ms')
    expect(formatDuration(42_000)).toBe('42s')
    expect(formatDuration(185_000)).toBe('3m 05s')
    expect(formatDuration(3_720_000)).toBe('1h 02m')
  })
})
