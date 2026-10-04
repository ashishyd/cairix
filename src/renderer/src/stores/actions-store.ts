import { create } from 'zustand'
import type { ActionContext, CustomAction } from '@shared/types'
import { errMsg } from '@/lib/util'
import { toast } from './toast-store'

interface Pending {
  action: CustomAction
  ctx: ActionContext
  summary: string
}

interface ActionsState {
  actions: CustomAction[]
  /** An action waiting for the user to confirm (shows exactly what will happen). */
  pending: Pending | null
  /** A shell action whose output is being shown. */
  output: { runId: string; name: string } | null
  load(): Promise<void>
  /** Entry point for every place an action can be triggered. */
  request(action: CustomAction, ctx: ActionContext): Promise<void>
  confirm(): Promise<void>
  cancel(): void
  closeOutput(): void
}

export const useActionsStore = create<ActionsState>((set, get) => ({
  actions: [],
  pending: null,
  output: null,
  load: async () => {
    set({ actions: await window.cairix.actions.list() })
    window.cairix.actions.onChange((actions) => set({ actions }))
  },
  request: async (action, ctx) => {
    try {
      const preview = await window.cairix.actions.preview(action.id, ctx)
      if (preview.confirm) return set({ pending: { action, ctx, summary: preview.summary } })
      await execute(action, ctx)
    } catch (e) {
      toast.error(errMsg(e))
    }
  },
  confirm: async () => {
    const p = get().pending
    set({ pending: null })
    if (!p) return
    try {
      await execute(p.action, p.ctx)
    } catch (e) {
      toast.error(errMsg(e))
    }
  },
  cancel: () => set({ pending: null }),
  closeOutput: () => set({ output: null })
}))

async function execute(action: CustomAction, ctx: ActionContext): Promise<void> {
  const result = await window.cairix.actions.run(action.id, ctx)
  if (result.runId) useActionsStore.setState({ output: { runId: result.runId, name: action.name } })
  else if (result.message) toast.success(result.message)
}

export const actionsFor = (actions: CustomAction[], scope: CustomAction['scope']): CustomAction[] => actions.filter((a) => a.scope === scope)
