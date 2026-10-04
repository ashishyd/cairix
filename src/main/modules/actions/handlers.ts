import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import { previewAction, runAction, type ExecDeps } from './exec'
import { draftSchema, type ActionStore } from './store'

const id = z.string().max(80)
const ctx = z.object({
  scope: z.enum(['project', 'port', 'finding']),
  projectId: z.string().max(80).optional(),
  port: z.number().int().optional(),
  pid: z.number().int().optional(),
  file: z.string().max(1000).optional(),
  line: z.number().int().optional()
})

export function registerActionsHandlers(store: ActionStore, deps: ExecDeps): void {
  const need = (actionId: string) => {
    const a = store.get(actionId)
    if (!a) throw new Error('That action no longer exists.')
    return a
  }
  handle(IPC.actionsList, z.tuple([]), () => store.list())
  handle(IPC.actionsSave, z.tuple([draftSchema]), (d) => store.save(d))
  handle(IPC.actionsDelete, z.tuple([id]), (i) => store.delete(i))
  handle(IPC.actionsPreview, z.tuple([id, ctx]), (i, c) => previewAction(need(i), c, deps))
  handle(IPC.actionsRun, z.tuple([id, ctx]), (i, c) => runAction(need(i), c, deps))
}
