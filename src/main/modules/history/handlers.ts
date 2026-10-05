import { homedir } from 'os'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { HistoryRerunResult, Project, Workspace } from '@shared/types'
import { handle } from '../../ipc'
import { runInTerminal, shq } from '../../terminal'
import type { ScriptRunner } from '../scripts/runner'
import type { HistoryService } from './service'

const rule = z.object({ kind: z.enum(['command', 'program']), value: z.string().min(1).max(2000) })
const rerun = z.object({ id: z.string().max(40), projectId: z.string().max(64).optional(), confirmed: z.boolean().optional() })

export interface HistoryHandlerDeps {
  runner: ScriptRunner
  findProject(id: string): { project: Project; workspace: Workspace } | undefined
}

const HOME_PROJECT: Project = { id: 'history', name: 'Commands', path: homedir(), relPath: '', kinds: [], isMonorepoRoot: false, parentId: null, hasGit: false }

export function registerHistoryHandlers(history: HistoryService, deps: HistoryHandlerDeps): void {
  handle(IPC.historyList, z.tuple([]), () => history.snapshot())
  handle(IPC.historyIgnore, z.tuple([rule]), (r) => history.ignore(r))
  handle(IPC.historyUnignore, z.tuple([rule]), (r) => history.unignore(r))

  // The renderer names a remembered command by id. The text to run is looked up
  // here, so a compromised renderer cannot make main run anything the user's own
  // shell has not already run.
  handle(IPC.historyRerun, z.tuple([rerun]), async (req): Promise<HistoryRerunResult> => {
    const entry = history.store.entry(req.id)
    if (!entry) throw new Error('That command is no longer in your list.')
    const command = entry.command
    if (entry.risky && !req.confirmed) throw new Error('This command deletes, forces or runs as administrator. Confirm to run it.')

    let cwd = homedir()
    let project: { project: Project; workspace: Workspace } | undefined
    if (req.projectId) {
      project = deps.findProject(req.projectId)
      if (!project) throw new Error('That project is no longer in Cairix.')
      if (!project.workspace.trusted) throw new Error(`Trust "${project.workspace.name}" before running commands in it.`)
      cwd = project.project.path
    }

    if (entry.interactive) {
      await runInTerminal(`cd ${shq(cwd)} && ${command}`)
      return { message: 'Opened in Terminal' }
    }

    // -i so aliases and shell functions from the user's zshrc (nvm, gst, ...) work as they do in Terminal.
    const run = await deps.runner.start(
      {
        def: { id: `history:${req.id}`, projectId: project?.project.id ?? 'history', name: command, command, source: 'package.json', category: 'other', needsTty: false },
        spawn: { file: '/bin/zsh', args: ['-ic', command], cwd, env: {} }
      },
      project?.project ?? HOME_PROJECT,
      project ? project.project.relPath || project.workspace.name : 'Commands',
      []
    )
    return { runId: run.runId }
  })
}
