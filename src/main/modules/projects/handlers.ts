import { dialog } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import { getMainWindow } from '../../window'
import type { ScriptRunner } from '../scripts/runner'
import {
  addWorkspace,
  listWorkspaces,
  previewFolder,
  removeWorkspace,
  rescanWorkspace,
  setTrust
} from './store'

/**
 * Folders the user picked in the native dialog during this session. Preview
 * and add only accept these, so the renderer can't ask main to crawl an
 * arbitrary path it invented.
 */
const approved = new Set<string>()

function requireApproved(path: string): void {
  if (!approved.has(path)) throw new Error('Choose the folder with the Add Folder button first.')
}

export function registerProjectsHandlers(runner: ScriptRunner): void {
  handle(IPC.projectsList, z.tuple([]), () => listWorkspaces())

  handle(IPC.projectsPickFolder, z.tuple([]), async () => {
    const win = getMainWindow()
    const opts = {
      title: 'Add a folder to Cairix',
      message: 'Pick a project, or a folder that holds several. Nested apps are found automatically.',
      buttonLabel: 'Add Folder',
      properties: ['openDirectory' as const]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    approved.add(result.filePaths[0])
    return result.filePaths[0]
  })

  handle(IPC.projectsPreview, z.tuple([z.string().max(4096)]), (path) => {
    requireApproved(path)
    return previewFolder(path)
  })

  handle(
    IPC.projectsAdd,
    z.tuple([
      z.object({
        path: z.string().max(4096),
        excludedPaths: z.array(z.string().max(4096)).max(5000),
        trusted: z.boolean()
      })
    ]),
    (req) => {
      requireApproved(req.path)
      return addWorkspace(req)
    }
  )

  handle(IPC.projectsRemove, z.tuple([z.string()]), (id) => {
    const ws = listWorkspaces().find((w) => w.id === id)
    if (ws) runner.stopForProjects(new Set(ws.projects.map((p) => p.id)))
    removeWorkspace(id)
  })

  handle(IPC.projectsRescan, z.tuple([z.string()]), (id) => rescanWorkspace(id))

  handle(IPC.projectsSetTrust, z.tuple([z.string(), z.boolean()]), (id, trusted) => {
    // Revoking trust also stops anything that folder is currently running.
    if (!trusted) {
      const ws = listWorkspaces().find((w) => w.id === id)
      if (ws) runner.stopForProjects(new Set(ws.projects.map((p) => p.id)))
    }
    return setTrust(id, trusted)
  })
}
