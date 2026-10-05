import { describe, expect, it } from 'vitest'
import { planStop, scanProcesses, shortName } from '../src/main/modules/processes/scan'
import type { PortEntry } from '../src/shared/types'

// pid ppid pgid rss pcpu etime command
const PS = `
    1     0     1  1000  0.0  05:00:00 /sbin/launchd
  100     1   100  9000  0.1  04:00:00 -zsh
  200   100   200 80000  2.0     10:00 node /Users/me/app/node_modules/.bin/pnpm dev
  201   200   200 150000 5.5     10:00 node /Users/me/app/node_modules/next/dist/bin/next dev
  202   201   200 90000  1.5     10:00 next-server (v15)
  300   100   300 40000  0.0   01:02:03 /usr/local/bin/redis-server *:6379
  400     1   400 70000  0.0   02:00:00 /Applications/Slack.app/Contents/MacOS/Slack
  500     1   500 12000  0.0   03:00:00 /Users/me/tools/sync-daemon --token sk-abcdefghijklmnopqrstuvwxyz
  900     1   900 99999  9.9     00:05 /Applications/Cairix.app/Contents/MacOS/Cairix
  901   900   900 55555  1.0     00:05 /Applications/Cairix.app/Contents/Frameworks/Cairix Helper
`

const deps = (extra: Partial<Parameters<typeof scanProcesses>[0]> = {}): Parameters<typeof scanProcesses>[0] => ({
  run: async () => PS,
  currentUser: 'me',
  selfPid: 901,
  ports: () => [{ pid: 202, port: 3000 } as PortEntry, { pid: 300, port: 6379 } as PortEntry],
  ...extra
})

describe('process scanning', () => {
  it('shows each dev tree once, with the memory and ports of the whole tree', async () => {
    const { entries } = await scanProcesses(deps(), 'dev')
    const next = entries.find((e) => e.pid === 200)!
    expect(next.procCount).toBe(3)
    expect(next.treeRssKb).toBe(80000 + 150000 + 90000)
    expect(next.ports).toEqual([3000])
    expect(entries.some((e) => e.pid === 201 || e.pid === 202)).toBe(false)
    expect(entries.find((e) => e.pid === 300)).toMatchObject({ framework: 'Redis', ports: [6379] })
  })
  it('sorts the heaviest first', async () => {
    const { entries } = await scanProcesses(deps(), 'dev')
    expect(entries.map((e) => e.pid)).toEqual([200, 300])
  })
  it('never lists shells, installed apps, launchd or Cairix itself', async () => {
    const { entries } = await scanProcesses(deps(), 'all')
    const pids = entries.map((e) => e.pid)
    for (const bad of [1, 100, 400, 900, 901]) expect(pids).not.toContain(bad)
  })
  it('never lists helper processes that Cairix itself launched', async () => {
    const out = PS + '  902   901   900 33333  1.0     00:05 /Users/me/dev/node_modules/electron/dist/Electron Helper (GPU)\n'
    const { entries } = await scanProcesses(deps({ run: async () => out }), 'all')
    expect(entries.map((e) => e.pid)).not.toContain(902)
  })
  it('"all" adds your other processes, and the dev tree is still one row', async () => {
    const { entries } = await scanProcesses(deps(), 'all')
    expect(entries.map((e) => e.pid).sort((a, b) => a - b)).toEqual([200, 300, 500])
  })
  it('redacts credentials in the command line it shows', async () => {
    const { entries } = await scanProcesses(deps(), 'all')
    const d = entries.find((e) => e.pid === 500)!
    expect(d.cmdline).not.toContain('sk-abcdefghij')
  })
  it('tags trees Cairix started', async () => {
    const { entries } = await scanProcesses(deps({ runForAncestors: (chain) => (chain.includes(200) ? 'run-1' : undefined) }), 'dev')
    expect(entries.find((e) => e.pid === 200)?.runId).toBe('run-1')
    expect(entries.find((e) => e.pid === 300)?.runId).toBeUndefined()
  })
  it('names a process by its executable', () => {
    expect(shortName('/usr/local/bin/redis-server *:6379')).toBe('redis-server')
    expect(shortName('/Applications/Some App.app/Contents/MacOS/Some App --flag')).toBe('Some App')
  })
})

describe('stopping a process', () => {
  it('plans the whole tree, leaves first', async () => {
    const scan = await scanProcesses(deps(), 'dev')
    expect(planStop(scan, 200)).toEqual({ ok: true, targets: [202, 201, 200] })
  })
  it('refuses a pid that is not a listed row (stale or forged)', async () => {
    const scan = await scanProcesses(deps(), 'dev')
    expect(planStop(scan, 201)).toMatchObject({ ok: false })
    expect(planStop(scan, 1)).toMatchObject({ ok: false })
    expect(planStop(scan, 900)).toMatchObject({ ok: false })
    expect(planStop(scan, 99999)).toMatchObject({ ok: false })
  })
  it('refuses a tree that contains Cairix', async () => {
    const out = PS.replace('  900     1   900', '  900     1   900').replace('/Applications/Cairix.app/Contents/MacOS/Cairix', '/Users/me/dev/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
    const scan = await scanProcesses(deps({ run: async () => out }), 'dev')
    // Electron (pid 900) is Cairix's own ancestor: it is excluded outright.
    expect(scan.entries.some((e) => e.pid === 900)).toBe(false)
    expect(planStop(scan, 900)).toMatchObject({ ok: false })
  })
})
