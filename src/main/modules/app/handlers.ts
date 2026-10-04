import { app, shell } from 'electron'
import { execFile } from 'child_process'
import { realpath } from 'fs/promises'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { settingsPatchSchema } from '@shared/settings'
import type { AppInfo } from '@shared/types'
import { handle } from '../../ipc'
import { isSafeExternalUrl } from '../../security'
import { getSettings, updateSettings } from '../../settings'
import { isInsideWorkspace } from '../projects/store'

const APP_NAMES = { terminal: 'Terminal', vscode: 'Visual Studio Code', cursor: 'Cursor' } as const

/** Resolves symlinks and insists the path belongs to a folder the user added. */
async function projectPath(raw: string): Promise<string> {
  let real: string
  try {
    real = await realpath(raw)
  } catch {
    throw new Error('That path does not exist.')
  }
  if (!isInsideWorkspace(real)) throw new Error('That path is outside your added folders.')
  return real
}

export function registerAppHandlers(): void {
  handle(IPC.appInfo, z.tuple([]), (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    node: process.versions.node,
    platform: process.platform,
    userDataPath: app.getPath('userData')
  }))

  handle(IPC.appOpenExternal, z.tuple([z.string().max(2048)]), (url) => {
    if (!isSafeExternalUrl(url)) throw new Error('Blocked: only https links and local dev servers can be opened.')
    return shell.openExternal(url)
  })

  handle(IPC.appShowInFolder, z.tuple([z.string().max(4096)]), async (path) => {
    shell.showItemInFolder(await projectPath(path))
  })

  handle(
    IPC.appOpenInApp,
    z.tuple([z.enum(['finder', 'terminal', 'vscode', 'cursor']), z.string().max(4096)]),
    async (which, path) => {
      const real = await projectPath(path)
      if (which === 'finder') {
        const err = await shell.openPath(real)
        if (err) throw new Error(err)
        return
      }
      await new Promise<void>((resolve, reject) => {
        // execFile with an argv array: the path is never interpreted by a shell.
        execFile('open', ['-a', APP_NAMES[which], real], (err) =>
          err ? reject(new Error(`Could not open ${APP_NAMES[which]}. Is it installed?`)) : resolve()
        )
      })
    }
  )

  handle(IPC.settingsGet, z.tuple([]), () => getSettings())
  handle(IPC.settingsSet, z.tuple([settingsPatchSchema]), (patch) => updateSettings(patch))
}
