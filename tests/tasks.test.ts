import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { parseStreamLine, describeTool } from '../src/main/modules/tasks/stream'
import type { AgentTask } from '../src/shared/types'

vi.mock('../src/main/shell-env', async () => {
  const actual = await vi.importActual<typeof import('../src/main/shell-env')>('../src/main/shell-env')
  return { ...actual, spawnEnv: async (extra: NodeJS.ProcessEnv = {}) => ({ ...actual.cleanChildEnv(process.env), ...extra }) }
})
const { TasksService, buildCommand } = await import('../src/main/modules/tasks/service')
const { ChangesService } = await import('../src/main/modules/changes/service')

const FAKE = join(__dirname, 'fixtures/fake-agent.mjs')
const dirs: string[] = []
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }) })
const tmp = (): string => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-tsk-'))); dirs.push(d); return d }
const sh = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' })
const write = (root: string, rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }
function repo(files: Record<string, string> = { 'src/a.ts': 'export const a = 1\n' }): string {
  const root = tmp()
  sh(root, 'init', '-q', '-b', 'main'); sh(root, 'config', 'user.email', 't@t'); sh(root, 'config', 'user.name', 't')
  for (const [k, v] of Object.entries(files)) write(root, k, v)
  sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', 'init')
  return root
}

function setup(path: string, over: { trusted?: boolean; maxConcurrent?: number; timeoutMs?: number; installed?: boolean; dataDir?: string; projectPath?: string } = {}) {
  const dataDir = over.dataDir ?? tmp()
  const log = join(dataDir, 'fake.log')
  process.env.CX_FAKE_LOG = log
  const changes = new ChangesService({ dataDir, project: () => ({ path: over.projectPath ?? path, trusted: over.trusted ?? true }), detectClaude: async () => ({ installed: true }) })
  const svc = new TasksService({
    dataDir,
    project: () => ({ path: over.projectPath ?? path, trusted: over.trusted ?? true }),
    detect: async () => ({ installed: over.installed ?? true }),
    registerProposal: (p, id, patch, cost) => changes.registerProposal(p, id, patch, 'agent', cost),
    bins: { claude: FAKE, cursor: FAKE },
    maxConcurrent: over.maxConcurrent,
    timeoutMs: over.timeoutMs
  })
  const calls = (): Array<{ args: string[]; cwd: string; pid: number; prompt: string; files: string[] }> =>
    existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
  return { svc, changes, dataDir, calls }
}
async function finished(svc: InstanceType<typeof TasksService>, id: string, ms = 8000): Promise<AgentTask> {
  const end = Date.now() + ms
  for (;;) {
    const t = svc.list('p').find((x) => x.id === id)!
    if (t.status !== 'running') return t
    if (Date.now() > end) throw new Error('task did not finish')
    await new Promise((r) => setTimeout(r, 15))
  }
}
const REQ = { agent: 'claude' as const, mode: 'read' as const, prompt: 'Explain the project' }

describe('stream parsing', () => {
  it('turns assistant text and tool calls into a feed, ignores system noise and tool output', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'hook_started' })).events).toEqual([])
    expect(parseStreamLine(JSON.stringify({ type: 'user', message: { content: [] } })).events).toEqual([])
    expect(parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }, { type: 'tool_use', name: 'Read', input: { file_path: 'a.ts' } }] } })).events).toEqual([
      { kind: 'text', text: 'Hi' }, { kind: 'tool', text: 'Read a.ts' }
    ])
  })
  it('reads the final result, cost and error flag', () => {
    expect(parseStreamLine(JSON.stringify({ type: 'result', is_error: false, result: 'ok', total_cost_usd: 0.5 })).final).toEqual({ text: 'ok', isError: false, costUsd: 0.5 })
    expect(parseStreamLine(JSON.stringify({ type: 'result', subtype: 'error_max_turns', result: '' })).final?.isError).toBe(true)
  })
  it('shows non-JSON lines as plain text and never throws on junk', () => {
    expect(parseStreamLine('plain output').events).toEqual([{ kind: 'text', text: 'plain output' }])
    expect(parseStreamLine('').events).toEqual([])
    for (const junk of ['{', '[1,2]', 'null', '"str"', '{"type":"assistant"}', '{"type":"assistant","message":{"content":"x"}}']) expect(() => parseStreamLine(junk)).not.toThrow()
  })
  it('masks credentials in the feed and the result', () => {
    const tok = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz'
    expect(JSON.stringify(parseStreamLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `key ${tok}` }] } })))).not.toContain(tok)
    expect(parseStreamLine(JSON.stringify({ type: 'result', result: `key ${tok}` })).final?.text).not.toContain(tok)
    expect(describeTool('Bash', { command: `curl -H "x: ${tok}"` })).not.toContain(tok)
  })
  it('describes tools compactly and clips long input', () => {
    expect(describeTool('Grep', { pattern: 'TODO' })).toBe('Grep TODO')
    expect(describeTool('Weird', {})).toBe('Weird')
    expect(describeTool('Read', { file_path: 'x'.repeat(500) }).length).toBeLessThanOrEqual(160)
  })
})

describe('command lines (where read-only is enforced)', () => {
  const bins = { claude: 'claude', cursor: 'cursor-agent' }
  it('claude read-only: can only Read/Grep/Glob, cannot edit or run anything, in plan mode', () => {
    const c = buildCommand({ ...REQ }, '/p', bins)
    const a = c.args.join(' ')
    expect(a).toContain('--allowedTools Read Grep Glob')
    expect(a).not.toMatch(/--allowedTools[^-]*(Edit|Write|Bash)/)
    expect(a).toMatch(/--disallowedTools Bash Edit Write/)
    expect(a).toContain('--permission-mode plan')
    expect(a).toContain('--output-format stream-json --verbose')
  })
  it('claude edit: may Edit/Write but never run commands or use the web', () => {
    const a = buildCommand({ ...REQ, mode: 'edit' }, '/p', bins).args.join(' ')
    expect(a).toContain('--allowedTools Read Grep Glob Edit Write')
    expect(a).toMatch(/--disallowedTools Bash WebFetch WebSearch/)
    expect(a).toContain('--permission-mode acceptEdits')
  })
  it('claude: the prompt goes on stdin, never into the visible command line, and spending is capped', () => {
    const c = buildCommand({ ...REQ, prompt: 'SECRET PLAN', budgetUsd: 1.25 }, '/p', bins)
    expect(c.args.join(' ')).not.toContain('SECRET PLAN')
    expect(c.stdin).toContain('SECRET PLAN')
    expect(c.args).toEqual(expect.arrayContaining(['--max-budget-usd', '1.25', '--no-session-persistence', '--strict-mcp-config']))
    expect(buildCommand(REQ, '/p', bins).args).toEqual(expect.arrayContaining(['--max-budget-usd', '0.5']))
  })
  it('cursor: sandboxed, pinned to the folder, ask-mode when read-only', () => {
    const r = buildCommand({ ...REQ, agent: 'cursor' }, '/work', bins)
    expect(r.args).toEqual(expect.arrayContaining(['-p', '--sandbox', 'enabled', '--workspace', '/work', '--mode', 'ask']))
    expect(buildCommand({ ...REQ, agent: 'cursor', mode: 'edit' }, '/work', bins).args).not.toContain('--mode')
  })
  it('tells the agent what it may do', () => {
    expect(buildCommand(REQ, '/p', bins).stdin).toMatch(/do not modify any file/)
    expect(buildCommand({ ...REQ, mode: 'edit' }, '/p', bins).stdin).toMatch(/smallest correct edits/)
  })
})

describe('running tasks (fake agent CLI, real git)', () => {
  it('read-only: streams a feed, returns a redacted answer and cost, and touches nothing', async () => {
    const root = repo()
    const { svc, calls } = setup(root)
    const t = await finished(svc, (await svc.start('p', REQ)).id)
    expect(t).toMatchObject({ status: 'done', costUsd: 0.0123, agent: 'claude', mode: 'read' })
    expect(t.events).toEqual([{ kind: 'text', text: 'Looking at the code.' }, { kind: 'tool', text: 'Read src/a.ts' }])
    expect(t.result).toContain('All done')
    expect(t.result).not.toContain('sk-ant-api03')
    expect(calls()[0].cwd).toBe(root) // read-only runs in place; the tools make that safe
    expect(sh(root, 'status', '--porcelain').trim()).toBe('')
  })

  it('edit: works in a throwaway copy, reports the change, and nothing lands until you apply (and undo works)', async () => {
    const root = repo()
    write(root, 'src/a.ts', 'export const a = 2 // uncommitted\n')
    const { svc, calls } = setup(root)
    const t = await finished(svc, (await svc.start('p', { ...REQ, mode: 'edit', prompt: 'EDIT: add a file' })).id)
    expect(t).toMatchObject({ status: 'done', changes: { files: ['agent-output.txt'], additions: 1, deletions: 0 } })
    // the agent ran in a worktree (not the project) that already contained the uncommitted edit
    expect(calls()[0].cwd).not.toBe(root)
    expect(calls()[0].files).toContain('src')
    expect(existsSync(join(root, 'agent-output.txt'))).toBe(false)
    expect(sh(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
    expect(sh(root, 'log', '--oneline').trim().split('\n')).toHaveLength(1)
  })

  it('edit → propose → apply → undo through the shared checked flow', async () => {
    const root = repo()
    const s = setup(root)
    const t = await finished(s.svc, (await s.svc.start('p', { ...REQ, mode: 'edit', prompt: 'EDIT: x' })).id)
    const proposal = await s.svc.propose(t.id)
    expect(proposal).toMatchObject({ by: 'agent', files: ['agent-output.txt'], applied: false })
    await s.changes.apply(proposal.id)
    expect(readFileSync(join(root, 'agent-output.txt'), 'utf8')).toBe('written by agent\n')
    await s.changes.undo(proposal.id)
    expect(existsSync(join(root, 'agent-output.txt'))).toBe(false)
  })

  it('a task in a monorepo sub-project runs in the matching subfolder and its patch uses repo paths', async () => {
    const root = repo({ 'apps/web/index.ts': 'x\n' })
    const s = setup(root, { projectPath: join(root, 'apps/web') })
    const t = await finished(s.svc, (await s.svc.start('p', { ...REQ, mode: 'edit', prompt: 'EDIT: x' })).id)
    expect(s.calls()[0].cwd.endsWith('apps/web')).toBe(true)
    expect(t.changes?.files).toEqual(['apps/web/agent-output.txt'])
  })

  it('an edit task that changes nothing is a normal success with no changes to apply', async () => {
    const s = setup(repo())
    const t = await finished(s.svc, (await s.svc.start('p', { ...REQ, mode: 'edit', prompt: 'just look' })).id)
    expect(t).toMatchObject({ status: 'done' })
    expect(t.changes).toBeUndefined()
    await expect(s.svc.propose(t.id)).rejects.toThrow(/no changes/)
  })

  it('works with the Cursor agent (prompt as an argument)', async () => {
    const s = setup(repo())
    const t = await finished(s.svc, (await s.svc.start('p', { ...REQ, agent: 'cursor' })).id)
    expect(t.status).toBe('done')
    expect(s.calls()[0].args.slice(0, 2)).toEqual(['-p', expect.stringContaining('Explain the project')])
    expect(t.budgetUsd).toBeUndefined() // no spending cap flag for Cursor
  })

  it.each([
    ['FAIL', /Something went wrong/],
    ['AUTH', /not signed in.*claude auth login/i],
    ['CRASH', /segfault-ish/]
  ])('%s becomes a clear failure and edit mode still cleans up', async (word, msg) => {
    const root = repo()
    const s = setup(root)
    const t = await finished(s.svc, (await s.svc.start('p', { ...REQ, mode: 'edit', prompt: `EDIT: ${word}` })).id)
    expect(t.status).toBe('failed')
    expect(t.error).toMatch(msg)
    expect(t.changes).toBeUndefined()
    expect(sh(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
  })

  it('cancel stops the agent process promptly and cleans up the copy', async () => {
    const root = repo()
    const s = setup(root)
    const started = await s.svc.start('p', { ...REQ, mode: 'edit', prompt: 'EDIT: SLOW' })
    for (let i = 0; i < 100 && s.calls().length === 0; i++) await new Promise((r) => setTimeout(r, 30))
    const pid = s.calls()[0].pid
    expect(() => process.kill(pid, 0)).not.toThrow() // running
    const t0 = Date.now()
    s.svc.cancel(started.id)
    const t = await finished(s.svc, started.id)
    expect(t.status).toBe('cancelled')
    expect(Date.now() - t0).toBeLessThan(3000)
    await new Promise((r) => setTimeout(r, 100))
    expect(() => process.kill(pid, 0)).toThrow() // gone
    expect(sh(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
  })

  it('a task that runs too long is stopped with a clear message', async () => {
    const s = setup(repo(), { timeoutMs: 400 })
    const t = await finished(s.svc, (await s.svc.start('p', { ...REQ, prompt: 'SLOW' })).id)
    expect(t).toMatchObject({ status: 'failed', error: expect.stringMatching(/too long/) })
  })

  it('caps the stored feed so a chatty agent cannot exhaust memory', async () => {
    const s = setup(repo())
    const t = await finished(s.svc, (await s.svc.start('p', { ...REQ, prompt: 'NOISY' })).id)
    expect(t.events.length).toBeLessThanOrEqual(80)
    expect(t.events.at(-1)?.text).toBe('Grep p699') // newest kept
  })

  it('shows non-JSON output as text instead of failing', async () => {
    const s = setup(repo())
    const t = await finished(s.svc, (await s.svc.start('p', { ...REQ, prompt: 'GARBAGE' })).id)
    expect(t.status).toBe('done')
    expect(t.events.map((e) => e.text)).toContain('this is not json')
  })
})

describe('guards', () => {
  it('refuses untrusted folders, non-git edits, a missing CLI, bad prompts and bad budgets', async () => {
    await expect(setup(repo(), { trusted: false }).svc.start('p', REQ)).rejects.toThrow(/Trust/)
    await expect(setup(tmp()).svc.start('p', { ...REQ, mode: 'edit' })).rejects.toThrow(/git repository/)
    const nonGitRead = setup(tmp())
    expect((await finished(nonGitRead.svc, (await nonGitRead.svc.start('p', REQ)).id)).status).toBe('done') // read-only is fine
    await expect(setup(repo(), { installed: false }).svc.start('p', REQ)).rejects.toThrow(/not found/)
    const s = setup(repo())
    await expect(s.svc.start('p', { ...REQ, prompt: '   ' })).rejects.toThrow(/Describe/)
    await expect(s.svc.start('p', { ...REQ, prompt: 'x'.repeat(8001) })).rejects.toThrow(/too long/)
    await expect(s.svc.start('p', { ...REQ, budgetUsd: 50 })).rejects.toThrow()
    await expect(s.svc.start('p', { ...REQ, agent: 'rm' as never })).rejects.toThrow()
  })
  it('limits how many tasks run at once', async () => {
    const s = setup(repo(), { maxConcurrent: 1 })
    const first = await s.svc.start('p', { ...REQ, prompt: 'SLOW' })
    await expect(s.svc.start('p', REQ)).rejects.toThrow(/already running/)
    s.svc.cancel(first.id)
    await finished(s.svc, first.id)
    await expect(s.svc.start('p', REQ)).resolves.toBeTruthy()
  })
})

describe('history', () => {
  it('survives a restart; a task running at quit becomes failed; remove deletes it and its saved changes', async () => {
    const root = repo()
    const s = setup(root)
    const done = await finished(s.svc, (await s.svc.start('p', { ...REQ, mode: 'edit', prompt: 'EDIT: keep' })).id)
    const running = await s.svc.start('p', { ...REQ, prompt: 'SLOW' })
    s.svc.stopAll()
    const again = setup(root, { dataDir: s.dataDir })
    const list = again.svc.list('p')
    expect(list.find((t) => t.id === done.id)).toMatchObject({ status: 'done' })
    expect(list.find((t) => t.id === running.id)).toMatchObject({ status: 'failed', error: expect.stringMatching(/closed/) })
    // the saved patch is still there after the restart, so the changes can still be reviewed
    expect((await again.svc.propose(done.id)).files).toEqual(['agent-output.txt'])
    await again.svc.remove(done.id)
    expect(again.svc.list('p').find((t) => t.id === done.id)).toBeUndefined()
    expect(existsSync(join(s.dataDir, 'agent-tasks', `${done.id}.patch`))).toBe(false)
  })
  it('will not remove a task that is still running', async () => {
    const s = setup(repo())
    const t = await s.svc.start('p', { ...REQ, prompt: 'SLOW' })
    await expect(s.svc.remove(t.id)).rejects.toThrow(/Cancel/)
    s.svc.cancel(t.id)
    await finished(s.svc, t.id)
  })
})
