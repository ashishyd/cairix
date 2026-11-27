import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync, utimesSync, writeFileSync } from 'fs'
import { join } from 'path'
import { diffSamples, FlightService } from '../src/main/modules/flight/service'
import { makeTree } from './helpers'

const base = { branch: 'main', head: 'a'.repeat(40), lock: 'pnpm-lock.yaml:10:1', envKeys: ['A'] }

describe('diffSamples', () => {
  it('reports nothing when nothing changed', () => expect(diffSamples(base, base)).toEqual([]))
  it('reports a branch switch without also reporting the commit change', () => {
    expect(diffSamples(base, { ...base, branch: 'dev', head: 'b'.repeat(40) }).map((e) => e.kind)).toEqual(['branch'])
  })
  it('reports a commit, a lockfile change and env key names', () => {
    const out = diffSamples(base, { ...base, head: 'b'.repeat(40), lock: 'pnpm-lock.yaml:11:2', envKeys: ['B'] })
    expect(out.map((e) => e.kind)).toEqual(['commit', 'deps', 'env'])
    expect(out[2].detail).toBe('added B · removed A')
  })
})

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

describe('FlightService', () => {
  it('baselines on first sight, then logs changes and failed runs, and never stores env values', async () => {
    const t = makeTree({ 'p/.env': 'API_KEY=sk-secret-value\n', 'p/pnpm-lock.yaml': 'x' })
    cleanups.push(t.cleanup)
    const dir = join(t.root, 'p')
    let branch = 'main'
    let trusted = true
    const file = join(t.root, 'flight.json')
    const svc = new FlightService({
      file,
      now: () => 1000,
      projects: () => [{ id: 'p1', name: 'proj', path: dir, trusted, hasGit: true }],
      git: async (_cwd, args) => (args.includes('--abbrev-ref') ? branch : 'c'.repeat(40)),
      lastPassAt: () => null,
      failedRuns: () => [{ runId: 'r1', projectId: 'p1', projectName: 'proj', scriptName: 'dev', endedAt: 500, exitCode: 1 }]
    })
    await svc.tick()
    expect(svc.list().map((e) => e.kind)).toEqual(['crash']) // baseline logs no change events

    branch = 'feature/x'
    writeFileSync(join(dir, '.env'), 'API_KEY=sk-secret-value\nNEW_FLAG=1\n')
    utimesSync(join(dir, 'pnpm-lock.yaml'), 1, 2)
    await svc.tick()
    expect(svc.list().map((e) => e.kind).sort()).toEqual(['branch', 'crash', 'deps', 'env'])
    await svc.tick() // the same failed run is not logged twice
    expect(svc.list().filter((e) => e.kind === 'crash')).toHaveLength(1)
    expect(readFileSync(file, 'utf8')).not.toMatch(/sk-secret-value/)

    trusted = false // untrusted projects are not even read
    branch = 'other'
    await svc.tick()
    expect(svc.list().some((e) => e.title.includes('other'))).toBe(false)
  })
})

describe('FlightService.sinceGood', () => {
  it('returns only changes after the last pass and up to the failure, oldest first', async () => {
    const t = makeTree({ 'p/pnpm-lock.yaml': 'x' })
    cleanups.push(t.cleanup)
    const dir = join(t.root, 'p')
    let now = 100
    let branch = 'main'
    const svc = new FlightService({
      file: join(t.root, 'flight.json'),
      now: () => now,
      projects: () => [{ id: 'p1', name: 'proj', path: dir, trusted: true, hasGit: true }],
      git: async (_cwd, args) => (args.includes('--abbrev-ref') ? branch : 'c'.repeat(40)),
      lastPassAt: (_p, script) => (script === 'build' ? 150 : null),
      failedRuns: () => (now >= 300 ? [{ runId: 'r9', projectId: 'p1', projectName: 'proj', scriptName: 'build', endedAt: 300, exitCode: 1 }] : [])
    })
    await svc.tick() // baseline
    now = 120
    branch = 'a'
    await svc.tick() // before the pass: excluded
    now = 200
    branch = 'b'
    await svc.tick() // after the pass: included
    now = 300
    await svc.tick() // logs the failure
    const res = svc.sinceGood('crash:r9')
    expect(res?.passedAt).toBe(150)
    expect(res?.events.map((e) => e.at)).toEqual([200])
    expect(svc.sinceGood('nope')).toBeNull()
    expect(svc.sinceGood(svc.list().find((e) => e.kind === 'branch')!.id)).toBeNull()
  })
})
