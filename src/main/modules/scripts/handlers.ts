import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { Project, Workspace } from '@shared/types'
import { handle } from '../../ipc'
import { runInTerminal, shq } from '../../terminal'
import { findProject, projectLabel } from '../projects/store'
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

export function registerScriptsHandlers(runner: ScriptRunner): void {
  handle(IPC.scriptsList, z.tuple([z.string().max(64)]), async (projectId) => {
    const found = findProject(projectId)
    return found ? (await detectScripts(found.project)).map((s) => s.def) : []
  })

  handle(IPC.scriptsRun, z.tuple([runRequest]), async (req) => {
    const { script, project, workspace } = await resolve(req.scriptId)
    requireTrusted(workspace)
    return runner.start(script, project, projectLabel(workspace, project), validateExtraArgs(req.args))
  })

  handle(IPC.scriptsStop, z.tuple([z.string(), z.boolean().optional()]), (runId, force) => {
    runner.stop(runId, force)
  })

  handle(IPC.scriptsRuns, z.tuple([]), () => runner.list())
  handle(IPC.scriptsLog, z.tuple([z.string()]), (runId) => runner.log(runId))

  handle(IPC.scriptsOpenInTerminal, z.tuple([runRequest]), async (req) => {
    const { script, workspace } = await resolve(req.scriptId)
    requireTrusted(workspace)
    const { spawn: spec } = script
    const argv = [spec.file, ...buildSpawnArgs(spec, validateExtraArgs(req.args))]
    const line = `cd ${shq(spec.cwd)} && ${argv.map(shq).join(' ')}`
    await runInTerminal(line)
  })
}
