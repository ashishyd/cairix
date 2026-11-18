import { describe, expect, it } from 'vitest'
import { bootScripts, bootWorkspace, envGaps, parkPlan, parkWorkspace, type WorkspaceApi } from '../src/shared/workspace'
import type { ContainerInfo, RunInfo, ScriptDef } from '../src/shared/types'

const script = (name: string, over: Partial<ScriptDef> = {}): ScriptDef => ({ id: `p1:${name}`, projectId: 'p1', name, command: name, source: 'package.json', category: 'dev', needsTty: false, ...over })
const run = (scriptId: string, over: Partial<RunInfo> = {}): RunInfo => ({ runId: `r-${scriptId}`, scriptId, projectId: 'p1', projectName: 'p', scriptName: scriptId.split(':')[1], command: '', pid: 1, startedAt: 0, status: 'running', ports: [], ...over })
const box = (name: string, state: string, projectId = 'p1'): ContainerInfo => ({ id: name, name, image: 'x', state, status: '', ports: '', projectId })

function fake(over: { scripts?: ScriptDef[]; runs?: RunInfo[]; containers?: ContainerInfo[]; clash?: Record<string, number>; missing?: string[] } = {}) {
  const calls: string[] = []
  const api: WorkspaceApi = {
    scripts: {
      list: async () => over.scripts ?? [],
      runs: async () => over.runs ?? [],
      checkPorts: async (id) => (over.clash?.[id] ? [{ port: over.clash[id], pid: 9, holder: 'node', protected: false, why: 'PORT' }] : []),
      run: async (req) => (calls.push(`run ${req.scriptId}`), run(req.scriptId)),
      stop: async (id) => void calls.push(`stop ${id}`)
    },
    containers: {
      list: async () => ({ at: 0, available: true, containers: over.containers ?? [] }),
      action: async (id, a) => (calls.push(`${a} ${id}`), { at: 0, available: true, containers: [] })
    },
    env: { list: async () => ({ hasGit: true, files: [{ name: '.env', kind: 'local', vars: [], gitignored: true, tracked: false, missing: over.missing ?? [], extra: [] }] }) }
  }
  return { api, calls }
}

describe('workspace boot', () => {
  it('picks only dev scripts that are not interactive or already running', () => {
    const list = [script('dev'), script('build', { category: 'build' }), script('repl', { needsTty: true }), script('web')]
    expect(bootScripts(list, [run('p1:web')]).map((s) => s.name)).toEqual(['dev'])
  })

  it('collects missing env keys from local files only', () => {
    expect(envGaps({ hasGit: true, files: [{ name: '.env', kind: 'local', vars: [], gitignored: true, tracked: false, missing: ['B', 'A'], extra: [] }, { name: '.env.example', kind: 'template', vars: [], gitignored: null, tracked: false, missing: ['Z'], extra: [] }] })).toEqual(['A', 'B'])
  })

  it('starts free scripts and stopped containers, skips a script whose port is taken, and warns about env', async () => {
    const { api, calls } = fake({ scripts: [script('dev'), script('api')], clash: { 'p1:api': 4000 }, containers: [box('db', 'exited'), box('cache', 'running'), box('other', 'exited', 'p2')], missing: ['DATABASE_URL'] })
    const r = await bootWorkspace('p1', api)
    expect(calls).toEqual(['run p1:dev', 'start db'])
    expect(r.started).toEqual(['dev', 'db'])
    expect(r.skipped).toEqual(['api: port 4000 is held by node'])
    expect(r.warnings[0]).toContain('DATABASE_URL')
  })

  it('reports a script that throws (for example an untrusted folder) instead of failing the whole boot', async () => {
    const { api } = fake({ scripts: [script('dev')] })
    api.scripts.run = async () => {
      throw new Error('Trust "x" before running its scripts.')
    }
    expect((await bootWorkspace('p1', api)).skipped).toEqual(['dev: Trust "x" before running its scripts.'])
  })
})

describe('workspace park', () => {
  it('stops only this project’s running scripts and containers, gently (no force)', async () => {
    const { api, calls } = fake({ runs: [run('p1:dev'), run('p2:dev', { projectId: 'p2' }), run('p1:old', { status: 'exited' })], containers: [box('db', 'running'), box('idle', 'exited'), box('x', 'running', 'p2')] })
    const plan = await parkPlan('p1', api)
    expect([plan.runs.length, plan.containers.length]).toEqual([1, 1])
    const r = await parkWorkspace(plan, api)
    expect(calls).toEqual(['stop r-p1:dev', 'stop db'])
    expect(r.stopped).toEqual(['dev', 'db'])
  })
})
