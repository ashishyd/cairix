import { create } from 'zustand'
import type { Project, Workspace } from '@shared/types'
import { errMsg } from '@/lib/util'
import { toast } from './toast-store'

interface ProjectsState {
  workspaces: Workspace[]
  loaded: boolean
  load(): Promise<void>
  rescan(id: string): Promise<void>
  remove(id: string): Promise<void>
  setTrust(id: string, trusted: boolean): Promise<void>
}

export const useProjectsStore = create<ProjectsState>((set) => ({
  workspaces: [],
  loaded: false,
  load: async () => {
    set({ workspaces: await window.cairix.projects.list(), loaded: true })
    window.cairix.projects.onChange((workspaces) => set({ workspaces }))
  },
  rescan: async (id) => {
    try {
      const ws = await window.cairix.projects.rescan(id)
      toast.success(`Rescanned ${ws.name}: ${ws.projects.length} project${ws.projects.length === 1 ? '' : 's'}`)
    } catch (e) {
      toast.error(errMsg(e))
    }
  },
  remove: async (id) => {
    try {
      await window.cairix.projects.remove(id)
    } catch (e) {
      toast.error(errMsg(e))
    }
  },
  setTrust: async (id, trusted) => {
    try {
      await window.cairix.projects.setTrust(id, trusted)
    } catch (e) {
      toast.error(errMsg(e))
    }
  }
}))

export interface ProjectRef {
  project: Project
  workspace: Workspace
}

/** Looks a project up across all workspaces. */
export function findProjectIn(workspaces: Workspace[], id: string): ProjectRef | undefined {
  for (const workspace of workspaces) {
    const project = workspace.projects.find((p) => p.id === id)
    if (project) return { project, workspace }
  }
  return undefined
}

/** Label for a project: its path inside the workspace, or the workspace name for the root. */
export function projectLabel(ref: ProjectRef): string {
  return ref.project.relPath || ref.workspace.name
}
