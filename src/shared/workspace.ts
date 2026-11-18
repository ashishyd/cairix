import type { CairixAPI } from './api'
import type { ContainerInfo, EnvSnapshot, RunInfo, ScriptDef } from './types'

/** The slice of `window.cairix` that boot and park need. Each call is re-validated in main, which only ever receives ids. */
export interface WorkspaceApi {
  scripts: Pick<CairixAPI['scripts'], 'list' | 'runs' | 'run' | 'stop' | 'checkPorts'>
  containers: Pick<CairixAPI['containers'], 'list' | 'action'>
  env: Pick<CairixAPI['env'], 'list'>
}

const active = (r: RunInfo): boolean => r.status === 'running' || r.status === 'stopping'
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * What "boot" starts: the project's dev scripts that are not already running.
 * shortcut: "dev" category only, no per-script opt-in; upgrade to a saved boot list if that picks wrong.
 */
export function bootScripts(scripts: ScriptDef[], runs: RunInfo[]): ScriptDef[] {
  const running = new Set(runs.filter(active).map((r) => r.scriptId))
  return scripts.filter((s) => s.category === 'dev' && !s.needsTty && !running.has(s.id))
}

/** Compose containers of this project that exist but are stopped. */
export const stoppedContainers = (all: ContainerInfo[], projectId: string): ContainerInfo[] =>
  all.filter((c) => c.projectId === projectId && c.state !== 'running')

/** Keys the project's templates expect that the local env files lack or leave empty. */
export const envGaps = (env: EnvSnapshot): string[] => [...new Set(env.files.filter((f) => f.kind === 'local').flatMap((f) => f.missing))].sort()

export interface BootReport {
  started: string[]
  /** Things that were not started, each with the reason. */
  skipped: string[]
  warnings: string[]
}

export async function bootWorkspace(projectId: string, api: WorkspaceApi): Promise<BootReport> {
  const report: BootReport = { started: [], skipped: [], warnings: [] }
  const gaps = await api.env.list(projectId).then(envGaps, () => [])
  if (gaps.length) report.warnings.push(`Env keys missing or empty: ${gaps.slice(0, 6).join(', ')}${gaps.length > 6 ? ', …' : ''}`)

  const [scripts, runs] = await Promise.all([api.scripts.list(projectId), api.scripts.runs()])
  // One at a time: a server that just started may take the port the next script wants.
  for (const s of bootScripts(scripts, runs)) {
    try {
      const clash = await api.scripts.checkPorts(s.id)
      if (clash.length) {
        report.skipped.push(`${s.name}: port ${clash[0].port} is held by ${clash[0].holder}`)
        continue
      }
      await api.scripts.run({ scriptId: s.id })
      report.started.push(s.name)
    } catch (e) {
      report.skipped.push(`${s.name}: ${msg(e)}`)
    }
  }

  const snap = await api.containers.list()
  if (snap.available) {
    for (const c of stoppedContainers(snap.containers, projectId)) {
      try {
        await api.containers.action(c.id, 'start')
        report.started.push(c.name)
      } catch (e) {
        report.skipped.push(`${c.name}: ${msg(e)}`)
      }
    }
  }
  return report
}

export interface ParkPlan {
  runs: RunInfo[]
  containers: ContainerInfo[]
}

/** Everything of this project that is running right now. */
export async function parkPlan(projectId: string, api: WorkspaceApi): Promise<ParkPlan> {
  const [runs, snap] = await Promise.all([api.scripts.runs(), api.containers.list()])
  return {
    runs: runs.filter((r) => r.projectId === projectId && r.status === 'running'),
    containers: snap.available ? snap.containers.filter((c) => c.projectId === projectId && c.state === 'running') : []
  }
}

/** Gentle stop only (SIGTERM, `docker stop`); nothing is force-killed. */
export async function parkWorkspace(plan: ParkPlan, api: WorkspaceApi): Promise<{ stopped: string[]; failed: string[] }> {
  const out = { stopped: [] as string[], failed: [] as string[] }
  for (const r of plan.runs) {
    try {
      await api.scripts.stop(r.runId)
      out.stopped.push(r.scriptName)
    } catch (e) {
      out.failed.push(`${r.scriptName}: ${msg(e)}`)
    }
  }
  for (const c of plan.containers) {
    try {
      await api.containers.action(c.id, 'stop')
      out.stopped.push(c.name)
    } catch (e) {
      out.failed.push(`${c.name}: ${msg(e)}`)
    }
  }
  return out
}
