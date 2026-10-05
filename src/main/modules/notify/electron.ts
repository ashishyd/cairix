import { BrowserWindow, Notification } from 'electron'
import { IPC } from '@shared/ipc'
import type { NavigateTarget } from '@shared/types'
import { broadcast } from '../../broadcast'
import { getSettings } from '../../settings'
import { showMainWindow } from '../../window'
import { findProject } from '../projects/store'
import { Notifier } from './notifier'

/** Held until closed: a Notification that is garbage collected never fires its click. */
const live = new Set<Notification>()

function navigate(target: NavigateTarget): void {
  showMainWindow()
  broadcast(IPC.uiNavigate, target)
}

export function createNotifier(): Notifier {
  return new Notifier({
    settings: () => getSettings().notifications,
    appFocused: () => BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused()),
    show: ({ title, body }, onClick) => {
      if (!Notification.isSupported()) return false
      const n = new Notification({ title, body })
      live.add(n)
      n.on('click', onClick)
      n.on('close', () => live.delete(n))
      n.show()
      return true
    },
    navigate,
    projectExists: (id) => !!findProject(id),
    projectName: (id) => {
      const f = findProject(id)
      if (f) return f.project.relPath || f.workspace.name
      return 'your project'
    }
  })
}
