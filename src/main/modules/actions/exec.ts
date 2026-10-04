import { execFile } from 'child_process'
import { realpath } from 'fs/promises'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import type { ActionContext, ActionPreview, ActionResult, CustomAction, Project, Workspace } from '@shared/types'
import { isSafeExternalUrl } from '../../security'
import type { ScriptRunner } from '../scripts/runner'
import { render, toShell, variablesIn, VARIABLES, envName } from './template'

export interface ExecDeps {
  runner: ScriptRunner
  findProject(id: string): { project: Project; workspace: Workspace } | undefined
  isInsideWorkspace(path: string): boolean
  branchOf(path: string): Promise<string>
  openExternal(url: string): Promise<void>
  /** Opens `path` in a macOS application. */
  openInApp(app: string, path: string): Promise<void>
}

/** Application names go to `open -a`; keep them to plain app-name characters. */
export const APP_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,59}$/

const SYNTHETIC: Project = { id: 'action', name: 'Action', path: homedir(), relPath: '', kinds: [], isMonorepoRoot: false, parentId: null, hasGit: false }

/**
 * Turns "this action, on that thing" into concrete values. Everything
 * the renderer sends is an id or a small number; the real paths and names are
 * looked up here, so a compromised renderer cannot make an action touch
 * anything outside the folders you added.
 */
export async function resolveValues(ctx: ActionContext, deps: ExecDeps): Promise<{ values: Record<string, string>; cwd: string; project?: { project: Project; workspace: Workspace } }> {
  const values: Record<string, string> = {}
  let found: { project: Project; workspace: Workspace } | undefined
  if (ctx.projectId) {
    found = deps.findProject(ctx.projectId)
    if (!found) throw new Error('That project is no longer in Cairix.')
    values['project.path'] = found.project.path
    values['project.name'] = found.project.relPath || found.workspace.name
    values.branch = found.project.hasGit ? await deps.branchOf(found.project.path) : ''
  }
  if (ctx.scope === 'port') {
    if (!Number.isInteger(ctx.port) || ctx.port! < 1 || ctx.port! > 65535) throw new Error('This action needs a port.')
    values.port = String(ctx.port)
    values.url = `http://localhost:${ctx.port}`
    if (Number.isInteger(ctx.pid) && ctx.pid! > 0) values.pid = String(ctx.pid)
  }
  if (ctx.scope === 'finding') {
    const file = ctx.file ?? ''
    if (!file || file.length > 1000 || file.includes('\0') || file.split('/').includes('..') || file.startsWith('/')) throw new Error('This action needs a file inside the project.')
    values.file = file
    values.line = Number.isInteger(ctx.line) ? String(ctx.line) : ''
  }
  return { values, cwd: found?.project.path ?? homedir(), project: found }
}

function missing(action: CustomAction, values: Record<string, string>): string | null {
  const need = variablesIn(action.template).concat(action.kind === 'app' && !action.template.trim() ? ['project.path'] : [])
  const gap = need.find((v) => VARIABLES[action.scope].includes(v) && !values[v] && v !== 'line' && v !== 'branch')
  return gap ? `This action uses {${gap}}, which is not known here (for example, the port was not started from one of your projects).` : null
}

export async function previewAction(action: CustomAction, ctx: ActionContext, deps: ExecDeps): Promise<ActionPreview> {
  const { values } = await resolveValues(ctx, deps)
  const gap = missing(action, values)
  if (gap) throw new Error(gap)
  const text = render(action.template, values)
  const summary = action.kind === 'shell' ? `Run: ${text}` : action.kind === 'url' ? `Open ${render(action.template, values, encodeURIComponent)}` : `Open ${text || values['project.path']} in ${action.app}`
  return { summary, kind: action.kind, confirm: action.confirm }
}

export async function runAction(action: CustomAction, ctx: ActionContext, deps: ExecDeps): Promise<ActionResult> {
  if (action.scope !== ctx.scope) throw new Error(`"${action.name}" is a ${action.scope} action and can't run here.`)
  const { values, cwd, project } = await resolveValues(ctx, deps)
  const gap = missing(action, values)
  if (gap) throw new Error(gap)

  if (action.kind === 'url') {
    const url = render(action.template, values, encodeURIComponent)
    if (!isSafeExternalUrl(url)) throw new Error('Actions can only open https links or local dev servers.')
    await deps.openExternal(url)
    return { message: `Opened ${new URL(url).host}` }
  }

  if (action.kind === 'app') {
    if (!action.app || !APP_NAME.test(action.app)) throw new Error('That application name is not valid.')
    const target = render(action.template || '{project.path}', values) || values['project.path']
    let real: string
    try {
      real = await realpath(target)
    } catch {
      throw new Error('That path does not exist.')
    }
    if (!deps.isInsideWorkspace(real)) throw new Error('Actions can only open files inside folders you added to Cairix.')
    await deps.openInApp(action.app, real)
    return { message: `Opened in ${action.app}` }
  }

  // shell: values go in the environment, never into the command text.
  const { script, vars } = toShell(action.template)
  const env: Record<string, string> = {}
  for (const v of vars) env[envName(v)] = values[v] ?? ''
  const runId = randomUUID()
  const scriptId = `action:${action.id}:${runId}`
  const run = await deps.runner.start(
    {
      def: { id: scriptId, projectId: project?.project.id ?? 'action', name: action.name, command: script, source: 'package.json', category: 'other', needsTty: false },
      spawn: { file: '/bin/zsh', args: ['-c', script], cwd, env }
    },
    project?.project ?? SYNTHETIC,
    project ? (project.project.relPath || project.workspace.name) : 'Action',
    []
  )
  return { runId: run.runId }
}

/** Default implementation of `openInApp` using execFile (no shell). */
export function openInMacApp(app: string, path: string): Promise<void> {
  return new Promise((resolve, reject) =>
    execFile('open', ['-a', app, path], (err) => (err ? reject(new Error(`Could not open ${app}. Is it installed?`)) : resolve()))
  )
}
