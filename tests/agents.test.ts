import { afterEach, describe, expect, it } from 'vitest'
import { utimesSync } from 'fs'
import { join } from 'path'
import { isSessionLive, parseLstart, readClaudeSessions } from '../src/main/modules/agents/claude'
import { cursorApp, findCursorWorkers, planTitle, readCursorPlans } from '../src/main/modules/agents/cursor'
import { buildAgentsSnapshot } from '../src/main/modules/agents/service'
import { parsePs } from '../src/main/modules/ports/parse'
import { CwdCache } from '../src/main/modules/ports/scanner'
import { makeTree } from './helpers'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})
function home(files: Record<string, string> = {}): string {
  const t = makeTree(files)
  cleanups.push(t.cleanup)
  return t.root
}

const session = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    pid: 4242,
    sessionId: 'sess-1',
    cwd: '/Users/x/proj',
    startedAt: 1_700_000_000_000,
    procStart: 'Sun Oct  4 08:59:20 2026',
    version: '2.1.286',
    kind: 'interactive',
    entrypoint: 'claude-desktop',
    name: 'Fix the login bug',
    status: 'busy',
    updatedAt: 1_700_000_100_000,
    // fields that must never surface:
    messagingSocketPath: '/tmp/secret.sock',
    peerFeatures: ['x'],
    ...over
  })

describe('readClaudeSessions', () => {
  it('reads <pid>.json and NEVER opens the *.key files next to them', async () => {
    const h = home({
      '.claude/sessions/4242.json': session(),
      // a key file that happens to be valid JSON must still be ignored, not merely fail to parse
      '.claude/sessions/4242.0123abcd.key': session({ sessionId: 'SECRET-FROM-KEY-FILE', pid: 9999 }),
      '.claude/sessions/notes.json': session({ sessionId: 'not-a-pid-file', pid: 8888 })
    })
    const recs = await readClaudeSessions(h)
    expect(recs.map((r) => r.sessionId)).toEqual(['sess-1'])
  })

  it('returns only the whitelisted fields (no socket path, no peer data)', async () => {
    const h = home({ '.claude/sessions/4242.json': session() })
    const [rec] = await readClaudeSessions(h)
    expect(Object.keys(rec).sort()).toEqual(['cwd', 'entrypoint', 'name', 'pid', 'procStart', 'sessionId', 'startedAt', 'status', 'updatedAt', 'version'])
    expect(JSON.stringify(rec)).not.toMatch(/secret\.sock|peerFeatures/)
  })

  it('skips corrupt and invalid files and survives a missing folder', async () => {
    const h = home({
      '.claude/sessions/1.json': '{ not json',
      '.claude/sessions/2.json': JSON.stringify({ pid: 'two' }),
      '.claude/sessions/3.json': session({ pid: 3, sessionId: 'ok' })
    })
    expect((await readClaudeSessions(h)).map((r) => r.sessionId)).toEqual(['ok'])
    expect(await readClaudeSessions(home())).toEqual([])
  })
})

describe('isSessionLive', () => {
  const procs = new Map(parsePs('4242 1 4242 1000 0.0 01:00 claude').map((p) => [p.pid, p]))
  const rec = (procStart?: string) => ({ pid: 4242, sessionId: 's', cwd: '/', startedAt: 0, procStart })

  it('is live when the pid exists and started at the recorded time', () => {
    expect(isSessionLive(rec('Sun Oct  4 08:59:20 2026'), procs, new Map([[4242, 'Sun Oct  4 08:59:20 2026']]))).toBe(true)
  })
  it('ignores whitespace differences in the start time', () => {
    expect(isSessionLive(rec('Sun Oct 4   08:59:20 2026'), procs, new Map([[4242, 'Sun Oct  4 08:59:20 2026']]))).toBe(true)
  })
  it('is stale when the pid was reused by a different process', () => {
    expect(isSessionLive(rec('Sun Oct  4 08:59:20 2026'), procs, new Map([[4242, 'Mon Oct  5 01:00:00 2026']]))).toBe(false)
  })
  it('is stale when the process is gone', () => {
    expect(isSessionLive(rec(), new Map(), new Map())).toBe(false)
  })
  it('falls back to "pid exists" when there is no start time to compare', () => {
    expect(isSessionLive(rec(undefined), procs, new Map())).toBe(true)
  })
  it('parses ps lstart output', () => {
    expect(parseLstart('  4242 Sun Oct  4 08:59:20 2026\n 99 Mon Oct  5 01:00:00 2026\n').get(4242)).toBe('Sun Oct  4 08:59:20 2026')
  })
})

describe('cursor', () => {
  const PS = [
    ' 100 1 100 700000 1.0 05:00:00 /Applications/Cursor.app/Contents/MacOS/Cursor',
    ' 101 100 100 300000 0.5 05:00:00 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer) --type=renderer',
    ' 200 1 200 35000 0.0 01:00:00 /Users/x/Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent --use-system-ca --api-key crsr_SECRET0123456789abcdef --worker-dir /x',
    ' 300 1 300 1000 0.0 00:10 /usr/bin/grep cursor-agent',
    ' 400 1 400 2000 0.0 00:10 node /x/cursor-agent-notes.js'
  ].join('\n')
  const procs = parsePs(PS)

  it('finds the real agent worker and nothing that merely mentions cursor-agent', () => {
    expect(findCursorWorkers(procs).map((p) => p.pid)).toEqual([200])
  })

  it('sums the editor and all its helpers', () => {
    expect(cursorApp(procs)).toEqual({ running: true, rssKb: 1_000_000 })
    expect(cursorApp([])).toEqual({ running: false, rssKb: 0 })
  })

  it('reads a plan title from front matter, with a tidy fallback', () => {
    expect(planTitle('---\nname: UX Modern Polish\noverview: x\n', 'fallback')).toBe('UX Modern Polish')
    expect(planTitle('# no front matter', 'fallback')).toBe('fallback')
  })

  it('lists recent plans newest first with titles', async () => {
    const h = home({
      '.cursor/plans/old_plan_aaaaaaaa.plan.md': '---\nname: Old plan\n---\nbody',
      '.cursor/plans/new_plan_bbbbbbbb.plan.md': '---\nname: New plan\n---\nbody',
      '.cursor/plans/untitled_cccccccc.plan.md': 'no front matter',
      '.cursor/plans/readme.txt': 'ignored'
    })
    utimesSync(join(h, '.cursor/plans/old_plan_aaaaaaaa.plan.md'), new Date(2020, 0, 1), new Date(2020, 0, 1))
    utimesSync(join(h, '.cursor/plans/untitled_cccccccc.plan.md'), new Date(2021, 0, 1), new Date(2021, 0, 1))
    const plans = await readCursorPlans(h)
    expect(plans.map((p) => p.title)).toEqual(['New plan', 'untitled', 'Old plan'])
  })
})

describe('buildAgentsSnapshot', () => {
  const PS = [
    ' 4242 1 4242 360000 28.5 02:00:00 /Users/x/Library/Application Support/Claude/claude-code/2.1.286/claude',
    ' 5000 1 5000 90000 0.0 03:00:00 /Users/x/.local/bin/cursor-agent --api-key crsr_SECRET0123456789abcdef --worker-dir /w',
    ' 6000 1 6000 1000 0.0 03:00:00 /bin/zsh'
  ].join('\n')

  function run(ps = PS) {
    return async (file: string, args: string[]) => {
      if (file === 'ps' && args.join(' ').includes('lstart=')) return ' 4242 Sun Oct  4 08:59:20 2026\n'
      if (file === 'ps') return ps
      if (file === 'lsof') return 'p5000\nfcwd\nn/Users/x/proj\n'
      return ''
    }
  }
  const detectCli = async (bin: string) => ({ installed: true, version: bin === 'claude' ? '2.1.282 (Claude Code)' : '2026.01.28' })

  it('combines live Claude sessions and Cursor workers, maps projects, and leaks no credentials', async () => {
    const h = home({
      '.claude/sessions/4242.json': session(),
      '.claude/sessions/777.json': session({ pid: 777, sessionId: 'dead', name: 'Crashed session' }) // pid not running
    })
    const snap = await buildAgentsSnapshot(
      { run: run(), home: h, detectCli, now: () => 1_700_000_200_000, resolveProject: (cwd) => (cwd.startsWith('/Users/x/proj') ? { id: 'p1', name: 'proj' } : undefined) },
      new CwdCache()
    )
    expect(snap.claude).toEqual({ installed: true, version: '2.1.282 (Claude Code)' })
    expect(snap.sessions.map((s) => [s.kind, s.title, s.status])).toEqual([
      ['claude', 'Fix the login bug', 'busy'],
      ['cursor', 'Cursor agent · proj', 'running']
    ])
    const cursor = snap.sessions.find((s) => s.kind === 'cursor')!
    expect(cursor).toMatchObject({ projectId: 'p1', projectName: 'proj', rssKb: 90000, cwd: '/Users/x/proj' })
    const claude = snap.sessions.find((s) => s.kind === 'claude')!
    expect(claude).toMatchObject({ rssKb: 360000, cpu: 28.5, surface: 'claude-desktop' })
    // the whole snapshot is what crosses to the UI
    expect(JSON.stringify(snap)).not.toMatch(/crsr_SECRET|--api-key|secret\.sock|peerFeatures/)
  })

  it('works when nothing is installed or running', async () => {
    const snap = await buildAgentsSnapshot(
      { run: async () => '', home: home(), detectCli: async () => ({ installed: false }) },
      new CwdCache()
    )
    expect(snap.sessions).toEqual([])
    expect(snap.claude.installed).toBe(false)
    expect(snap.cursor).toMatchObject({ installed: false, appRunning: false, appRssKb: 0 })
  })
})
