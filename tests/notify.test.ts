import { describe, expect, it } from 'vitest'
import { auditNotice, LONG_RUN_MS, runNotice, taskNotice } from '../src/main/modules/notify/rules'
import { Notifier, type NotifierDeps } from '../src/main/modules/notify/notifier'
import { DEFAULT_NOTIFICATIONS, type NotificationSettings } from '../src/shared/settings-types'
import type { AgentTask, AuditState, NavigateTarget, RunInfo } from '../src/shared/types'

const run = (over: Partial<RunInfo> = {}): RunInfo => ({
  runId: 'r1', scriptId: 'p1:build', projectId: 'p1', projectName: 'web-app', scriptName: 'build', command: 'pnpm build',
  pid: 1, startedAt: 1_000_000, endedAt: 1_000_000 + 40_000, status: 'failed', exitCode: 2, ports: [], ...over
})
const exists = (): boolean => true

describe('run notices', () => {
  it('says when a script failed, with the exit code and how long it ran', () => {
    const n = runNotice(run(), exists)!
    expect(n.title).toBe('build failed')
    expect(n.body).toBe('web-app · exit code 2 · after 40s')
    expect(n.target).toEqual({ kind: 'project', projectId: 'p1', tab: 'scripts' })
  })
  it('explains a port clash instead of an exit code', () => {
    expect(runNotice(run({ portConflict: 3000 }), exists)!.body).toContain('port 3000 is already in use')
  })
  it('notifies a failure even when it was instant', () => {
    expect(runNotice(run({ endedAt: 1_000_300 }), exists)).not.toBeNull()
  })
  it('only announces a success once it was long enough to look away', () => {
    expect(runNotice(run({ status: 'exited', exitCode: 0, endedAt: 1_000_000 + LONG_RUN_MS - 1 }), exists)).toBeNull()
    expect(runNotice(run({ status: 'exited', exitCode: 0, endedAt: 1_000_000 + LONG_RUN_MS }), exists)!.title).toBe('build finished')
  })
  it('never notifies about something you stopped yourself, or a run still going', () => {
    expect(runNotice(run({ status: 'stopped' }), exists)).toBeNull()
    expect(runNotice(run({ status: 'running', endedAt: undefined }), exists)).toBeNull()
  })
  it('sends runs without a real project (Commands, Actions) or a removed project to the Runs page', () => {
    expect(runNotice(run({ projectId: 'history' }), exists)!.target).toEqual({ kind: 'machine', page: 'runs' })
    expect(runNotice(run({ projectId: 'action' }), exists)!.body).not.toContain('·  ·')
    expect(runNotice(run(), () => false)!.target).toEqual({ kind: 'machine', page: 'runs' })
  })
})

const task = (over: Partial<AgentTask> = {}): AgentTask => ({ id: 't', projectId: 'p1', agent: 'claude', mode: 'read', prompt: 'Explain how auth works', status: 'done', startedAt: 1, events: [], ...over })

describe('task and audit notices', () => {
  it('announces a finished read-only task and a failed one', () => {
    expect(taskNotice(task())!.title).toBe('Agent task finished')
    const failed = taskNotice(task({ status: 'failed', error: 'Not signed in' }))!
    expect(failed.title).toBe('Agent task failed')
    expect(failed.body).toBe('Not signed in')
  })
  it('says an edit task has changes ready to review', () => {
    const n = taskNotice(task({ mode: 'edit', changes: { files: ['a.ts', 'b.ts'], additions: 3, deletions: 1 } }))!
    expect(n.title).toBe('Agent changes ready to review')
    expect(n.body).toContain('2 files changed')
    expect(n.target).toEqual({ kind: 'project', projectId: 'p1', tab: 'tasks' })
  })
  it('stays quiet for a cancelled task or one still running', () => {
    expect(taskNotice(task({ status: 'cancelled' }))).toBeNull()
    expect(taskNotice(task({ status: 'running' }))).toBeNull()
  })
  const audit = (over: Partial<AuditState> = {}): AuditState => ({ projectId: 'p1', phase: 'done', progress: { done: 1, total: 1 }, findings: [], instantCount: 0, costUsd: 0, failedRequests: 0, filesAnalyzed: 1, dismissedCount: 0, ...over })
  it('summarises an audit and reports a failed one', () => {
    expect(auditNotice(audit(), 'web-app')!.body).toBe('No findings.')
    expect(auditNotice(audit({ findings: [{} as never, {} as never] }), 'web-app')!.body).toBe('2 findings')
    expect(auditNotice(audit({ phase: 'error', error: 'quota' }), 'web-app')!.title).toBe('Audit failed for web-app')
    expect(auditNotice(audit({ phase: 'cancelled' }), 'web-app')).toBeNull()
    expect(auditNotice(audit({ phase: 'running' }), 'web-app')).toBeNull()
  })
})

function setup(settings: Partial<NotificationSettings> = {}, focused = false) {
  const shown: Array<{ title: string; body: string }> = []
  const clicks: Array<() => void> = []
  const went: NavigateTarget[] = []
  const s: NotificationSettings = { ...DEFAULT_NOTIFICATIONS, ...settings }
  const deps: NotifierDeps = {
    settings: () => s,
    appFocused: () => focused,
    show: (n, onClick) => (shown.push(n), clicks.push(onClick), true),
    navigate: (t) => went.push(t),
    projectExists: exists,
    projectName: () => 'web-app'
  }
  return { n: new Notifier(deps), shown, clicks, went }
}

describe('the notifier', () => {
  it('shows a notice and takes you to its target when clicked', () => {
    const { n, shown, clicks, went } = setup()
    n.run(run())
    expect(shown).toHaveLength(1)
    clicks[0]()
    expect(went).toEqual([{ kind: 'project', projectId: 'p1', tab: 'scripts' }])
  })
  it('respects the master switch and each category', () => {
    for (const off of [{ enabled: false }, { runs: false }]) {
      const { n, shown } = setup(off)
      n.run(run())
      expect(shown, JSON.stringify(off)).toHaveLength(0)
    }
    const { n, shown } = setup({ tasks: false, audits: false })
    n.task(task())
    n.audit({ projectId: 'p1', phase: 'done', progress: { done: 1, total: 1 }, findings: [], instantCount: 0, costUsd: 0, failedRequests: 0, filesAnalyzed: 0, dismissedCount: 0 })
    expect(shown).toHaveLength(0)
  })
  it('stays quiet while you are looking at Cairix, unless told otherwise', () => {
    const quiet = setup({}, true)
    quiet.n.run(run())
    expect(quiet.shown).toHaveLength(0)
    const loud = setup({ onlyInBackground: false }, true)
    loud.n.run(run())
    expect(loud.shown).toHaveLength(1)
  })
  it('the test notification ignores every setting', () => {
    const { n, shown } = setup({ enabled: false }, true)
    expect(n.test()).toBe(true)
    expect(shown).toHaveLength(1)
  })
})
