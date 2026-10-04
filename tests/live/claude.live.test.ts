import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { AuditService } from '../../src/main/modules/audit/service'
import { ChangesService } from '../../src/main/modules/changes/service'
import { detectCli } from '../../src/main/modules/agents/service'
import { TasksService } from '../../src/main/modules/tasks/service'
import type { AuditState, Finding } from '../../src/shared/types'

/**
 * Opt-in tests against the REAL `claude` CLI (you must be logged in):
 *   CAIRIX_LIVE=1 pnpm vitest run tests/live/claude.live.test.ts
 * They cost a few cents. Everything runs in a throwaway git repo.
 */

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))
const tmp = (): string => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-claude-'))); dirs.push(d); return d }
const sh = (cwd: string, ...a: string[]): string => execFileSync('git', a, { cwd, encoding: 'utf8' })
const write = (root: string, rel: string, text: string): void => { mkdirSync(dirname(join(root, rel)), { recursive: true }); writeFileSync(join(root, rel), text) }

const CODE = `import { db } from './db'

export async function findUser(name: string) {
  // look the user up by whatever the caller typed
  const rows = await db.query("SELECT * FROM users WHERE name = '" + name + "'")
  return rows[0]
}

export function save(user: object) {
  db.insert(user) // not awaited, errors are lost
}
`

function repo(): string {
  const root = tmp()
  sh(root, 'init', '-q', '-b', 'main'); sh(root, 'config', 'user.email', 't@t'); sh(root, 'config', 'user.name', 't')
  write(root, 'src/db.ts', 'export const db = { query: async (s: string): Promise<any[]> => [], insert: async (u: object) => {} }\n')
  write(root, 'src/a.ts', 'export const a = 1\n')
  sh(root, 'add', '-A'); sh(root, 'commit', '-q', '-m', 'init')
  write(root, 'src/a.ts', CODE) // the uncommitted change under review
  return root
}

const dataDir = tmp()
const root = repo()
const project = () => ({ path: root, trusted: true })
const changes = new ChangesService({ dataDir, project, detectClaude: () => detectCli('claude') })

describe.skipIf(!process.env.CAIRIX_LIVE)('real Claude CLI', () => {
  it('is installed and logged in', async () => {
    expect((await detectCli('claude')).installed).toBe(true)
  })

  it('AI review: returns valid structured findings about the uncommitted code', async () => {
    const state = await changes.review('p')
    // eslint-disable-next-line no-console
    console.log('REVIEW', JSON.stringify({ ai: state.ai, findings: state.findings.map((f) => [f.origin, f.severity, f.title, f.line, f.learn?.source]) }, null, 1))
    expect(state.ai.error, state.ai.error).toBeUndefined()
    expect(state.ai.reviewed).toBe(true)
    expect(state.ai.costUsd).toBeGreaterThan(0)
    for (const f of state.findings) {
      expect(f.file).toBe('src/a.ts')
      expect(['error', 'warning', 'info']).toContain(f.severity)
    }
    expect(state.findings.some((f) => f.origin === 'ai')).toBe(true) // it should notice the SQL string-building or the lost promise
  }, 180_000)

  it('audit: plans, runs and finishes with real findings', async () => {
    const audit = new AuditService({ dataDir, project, detectClaude: () => detectCli('claude'), isDismissed: () => false })
    const plan = await audit.plan('p', { categories: ['bugs', 'security'] })
    expect(plan).toMatchObject({ aiAvailable: true, files: 2 })
    await audit.start('p', { categories: ['bugs', 'security'] })
    let s: AuditState
    const end = Date.now() + 150_000
    do {
      await new Promise((r) => setTimeout(r, 500))
      s = audit.status('p')
    } while (s.phase === 'running' && Date.now() < end)
    // eslint-disable-next-line no-console
    console.log('AUDIT', JSON.stringify({ phase: s.phase, cost: s.costUsd, failed: s.failedRequests, error: s.error, findings: s.findings.map((f) => [f.origin, f.severity, f.title]) }, null, 1))
    expect(s.error, s.error).toBeUndefined()
    expect(s.phase).toBe('done')
    expect(s.failedRequests).toBe(0)
    expect(s.costUsd).toBeGreaterThan(0)
    expect(s.findings.length).toBeGreaterThan(0)
  }, 200_000)

  it('AI fix: Claude edits a throwaway copy; the diff applies and undoes cleanly', async () => {
    const finding: Finding = {
      id: 'live-1', severity: 'error', category: 'security', file: 'src/a.ts', line: 5, origin: 'ai', quickFix: false,
      title: 'SQL is built by string concatenation',
      explanation: 'The name is concatenated into the query, so a crafted name can change the query. Use a parameterised query.'
    }
    const before = readFileSync(join(root, 'src/a.ts'), 'utf8')
    const proposal = await changes.fixFinding('p', finding)
    // eslint-disable-next-line no-console
    console.log('FIX', proposal.by, proposal.costUsd, '\n' + proposal.patch)
    expect(proposal.by).toBe('claude')
    expect(proposal.files).toContain('src/a.ts') // it may legitimately touch db.ts too
    expect(proposal.patch).toMatch(/^[-+]/m)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(before) // preview changed nothing
    expect(sh(root, 'worktree', 'list').trim().split('\n')).toHaveLength(1)
    await changes.apply(proposal.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).not.toBe(before)
    await changes.undo(proposal.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(before)
  }, 240_000)

  const tasks = new TasksService({
    dataDir, project, detect: (b) => detectCli(b),
    registerProposal: (p, id, patch, cost) => changes.registerProposal(p, id, patch, 'agent', cost)
  })
  async function done(id: string, ms = 200_000) {
    const end = Date.now() + ms
    for (;;) {
      const t = tasks.list('p').find((x) => x.id === id)!
      if (t.status !== 'running' || Date.now() > end) return t
      await new Promise((r) => setTimeout(r, 400))
    }
  }

  it('task (read-only): streams real events and returns an answer without touching files', async () => {
    const before = sh(root, 'status', '--porcelain')
    const t = await done((await tasks.start('p', { agent: 'claude', mode: 'read', prompt: 'In one sentence: what does the function findUser in src/a.ts do?', budgetUsd: 0.25 })).id)
    // eslint-disable-next-line no-console
    console.log('TASK-READ', JSON.stringify({ status: t.status, error: t.error, cost: t.costUsd, events: t.events.map((e) => `${e.kind}: ${e.text.slice(0, 90)}`), result: t.result?.slice(0, 200) }, null, 1))
    expect(t.error, t.error).toBeUndefined()
    expect(t.status).toBe('done')
    expect(t.result).toMatch(/user/i)
    expect(t.costUsd).toBeGreaterThan(0)
    expect(sh(root, 'status', '--porcelain')).toBe(before)
  }, 240_000)

  it('task (make changes): edits a throwaway copy, you review, apply and undo', async () => {
    const before = readFileSync(join(root, 'src/a.ts'), 'utf8')
    const t = await done((await tasks.start('p', { agent: 'claude', mode: 'edit', prompt: 'At the very top of src/a.ts add this exact one-line comment: // reviewed by cairix live test', budgetUsd: 0.5 })).id)
    // eslint-disable-next-line no-console
    console.log('TASK-EDIT', JSON.stringify({ status: t.status, error: t.error, cost: t.costUsd, changes: t.changes, events: t.events.map((e) => `${e.kind}: ${e.text.slice(0, 80)}`) }, null, 1))
    expect(t.error, t.error).toBeUndefined()
    expect(t.status).toBe('done')
    expect(t.changes?.files).toEqual(['src/a.ts'])
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(before) // nothing lands before Apply
    expect(existsSync(join(root, '.git/worktrees')) ? sh(root, 'worktree', 'list').trim().split('\n').length : 1).toBe(1)
    const p = await tasks.propose(t.id)
    await changes.apply(p.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toContain('// reviewed by cairix live test')
    await changes.undo(p.id)
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe(before)
  }, 300_000)
})
