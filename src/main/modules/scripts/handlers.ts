import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { PortConflict, PortEntry, Project, RunInfo, Workspace } from '@shared/types'
import { handle } from '../../ipc'
import { runInTerminal, shq } from '../../terminal'
import { readFile, realpath, stat } from 'fs/promises'
import { isAbsolute, join, sep } from 'path'
import { parseArgs } from '@shared/args'
import { predictPorts } from '@shared/ports-predict'
import { parseEnv, varsOf } from '../env/parse'
import { openInEditor } from './editor'
import { findProject, isInsideWorkspace, projectLabel } from '../projects/store'
import type { ScriptConfigStore } from './config'
import { detectScripts, type ResolvedScript } from './detect'
import { buildSpawnArgs, validateExtraArgs, type ScriptRunner } from './runner'

const runRequest = z.object({ scriptId: z.string().max(600), args: z.array(z.string()).optional() })

/**
 * The renderer names a script by id; the command to execute is always rebuilt
 * here from files on disk. A compromised renderer therefore can't smuggle in
 * an arbitrary command: it can only start what detection would list.
 */
async function resolve(scriptId: string): Promise<{ script: ResolvedScript; project: Project; workspace: Workspace }> {
  const found = findProject(scriptId.split(':')[0])
  if (!found) throw new Error('That project is no longer in Cairix.')
  const script = (await detectScripts(found.project)).find((s) => s.def.id === scriptId)
  if (!script) throw new Error('That script no longer exists. It may have been renamed or removed.')
  return { script, ...found }
}

function requireTrusted(workspace: Workspace): void {
  if (!workspace.trusted) {
    throw new Error(`Trust "${workspace.name}" before running its scripts. Scripts can run any code in that folder.`)
  }
}

/** Does a script with this id exist right now? (Used to validate a schedule before saving it.) */
export async function scriptExists(scriptId: string): Promise<boolean> {
  try {
    await resolve(scriptId)
    return true
  } catch {
    return false
  }
}

/** Starts a detected script by id, with the same trust rules as the Run button. */
export async function startScriptById(runner: ScriptRunner, scriptId: string, args: string[] = [], autoRestarts = 0, extraEnv: Record<string, string> = {}): Promise<RunInfo> {
  const { script, project, workspace } = await resolve(scriptId)
  requireTrusted(workspace)
  // The script's own environment, with the user's saved overrides on top.
  const withEnv = Object.keys(extraEnv).length > 0 ? { ...script, spawn: { ...script.spawn, env: { ...script.spawn.env, ...extraEnv } } } : script
  return runner.start(withEnv, project, projectLabel(workspace, project), validateExtraArgs(args), autoRestarts)
}

export interface ScriptsHandlerDeps {
  /** Listening ports right now, for the "port already in use" warning. */
  listeners(): Promise<PortEntry[]>
}

/** Where a script's saved or project-level PORT comes from, for prediction. */
async function projectPort(dir: string): Promise<string | undefined> {
  for (const name of ['.env.local', '.env.development', '.env']) {
    try {
      const hit = varsOf(parseEnv(await readFile(join(dir, name), 'utf8'))).find((v) => v.key === 'PORT')
      if (hit?.value) return hit.value
    } catch {
      /* no such file */
    }
  }
  return undefined
}

export function registerScriptsHandlers(runner: ScriptRunner, configs: ScriptConfigStore, deps: ScriptsHandlerDeps): void {
  handle(IPC.scriptsList, z.tuple([z.string().max(64)]), async (projectId) => {
    const found = findProject(projectId)
    return found ? (await detectScripts(found.project)).map((s) => s.def) : []
  })

  handle(IPC.scriptsRun, z.tuple([runRequest]), async (req) => {
    // No explicit arguments (the Home dashboard, a shortcut): use the ones saved for the script.
    const cfg = configs.get(req.scriptId)
    return startScriptById(runner, req.scriptId, req.args ?? parseArgs(cfg?.args ?? ''), 0, cfg?.env)
  })

  handle(IPC.scriptsStop, z.tuple([z.string(), z.boolean().optional()]), (runId, force) => {
    runner.stop(runId, force)
  })

  handle(IPC.scriptsCheckPorts, z.tuple([z.string().max(600), z.array(z.string()).optional()]), async (scriptId, args): Promise<PortConflict[]> => {
    const { script, project } = await resolve(scriptId)
    const cfg = configs.get(scriptId)
    const env: Record<string, string> = { ...cfg?.env, ...script.spawn.env }
    let source = 'PORT in your saved environment'
    if (!env.PORT) {
      const fromFile = await projectPort(project.path)
      if (fromFile) {
        env.PORT = fromFile
        source = 'PORT in .env'
      }
    }
    const extra = args ?? parseArgs(cfg?.args ?? '')
    const predicted = predictPorts([script.def.command, ...extra].join(' '), env, source)
    const mine = new Set(runner.list().filter((r) => r.scriptId === scriptId && (r.status === 'running' || r.status === 'stopping')).map((r) => r.runId))
    const out: PortConflict[] = []
    if (predicted.length === 0) return out
    // A fresh look: a server started a second ago is not in the last scheduled scan yet.
    const listening = await deps.listeners()
    for (const p of predicted) {
      const holder = listening.find((e) => e.port === p.port && !(e.runId && mine.has(e.runId)))
      if (holder) out.push({ port: p.port, pid: holder.pid, holder: holder.name, framework: holder.framework, projectName: holder.projectName, protected: holder.protected, hint: holder.hint, why: p.why })
    }
    return out
  })

  handle(IPC.scriptsOpenFile, z.tuple([z.string().max(80), z.string().max(1000), z.number().int().min(1).max(10_000_000).optional(), z.number().int().min(1).max(100_000).optional()]), async (runId, file, line, column) => {
    const info = runner.get(runId)
    const found = info ? findProject(info.projectId) : undefined
    if (!found) throw new Error('That run is not tied to a project, so its files cannot be opened from here.')
    if (file.includes('\0')) throw new Error('Invalid file name.')
    // Relative paths are relative to the project; the real path must stay inside it.
    const candidate = isAbsolute(file) ? file : join(found.project.path, file)
    let real: string
    try {
      real = await realpath(candidate)
      if (!(await stat(real)).isFile()) throw new Error('not a file')
    } catch {
      throw new Error('That file does not exist.')
    }
    const root = await realpath(found.project.path)
    if (real !== root && !real.startsWith(root + sep) && !isInsideWorkspace(real)) throw new Error('That file is outside your projects.')
    await openInEditor(real, line, column)
  })

  handle(IPC.scriptsConfigs, z.tuple([]), () => configs.all())
  handle(
    IPC.scriptsSetConfig,
    z.tuple([z.string().max(300), z.object({ args: z.string(), env: z.record(z.string(), z.string()), watch: z.boolean() }).nullable()]),
    async (scriptId, cfg) => {
      // The id must name a script that exists today, so the file cannot fill up with made-up ids.
      await resolve(scriptId)
      return configs.set(scriptId, cfg)
    }
  )

  handle(IPC.scriptsRuns, z.tuple([]), () => runner.list())
  handle(IPC.scriptsLog, z.tuple([z.string()]), (runId) => runner.log(runId))

  handle(IPC.scriptsOpenInTerminal, z.tuple([runRequest]), async (req) => {
    const { script, workspace } = await resolve(req.scriptId)
    requireTrusted(workspace)
    const { spawn: spec } = script
    const argv = [spec.file, ...buildSpawnArgs(spec, validateExtraArgs(req.args))]
    const env = Object.entries(configs.get(req.scriptId)?.env ?? {}).map(([k, v]) => shq(`${k}=${v}`))
    const line = `cd ${shq(spec.cwd)} && ${env.length > 0 ? `env ${env.join(' ')} ` : ''}${argv.map(shq).join(' ')}`
    await runInTerminal(line)
  })
}
