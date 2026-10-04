import { app } from 'electron'
import { homedir } from 'os'
import { realpath, stat } from 'fs/promises'
import { basename, isAbsolute, join, sep } from 'path'
import { z } from 'zod'
import { IPC } from '@shared/ipc'
import type { AddWorkspaceRequest, DiscoveryPreview, Project, Workspace } from '@shared/types'
import { broadcast } from '../../broadcast'
import { readJson, writeJsonAtomic } from '../../json-store'
import { discoverProjects, projectId } from './discovery'

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  relPath: z.string(),
  kinds: z.array(z.enum(['node', 'python', 'rust', 'go', 'compose', 'make'])),
  packageManager: z.enum(['pnpm', 'npm', 'yarn', 'bun']).optional(),
  isMonorepoRoot: z.boolean(),
  parentId: z.string().nullable(),
  hasGit: z.boolean()
})

const workspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  addedAt: z.number(),
  trusted: z.boolean(),
  excludedPaths: z.array(z.string()),
  projects: z.array(projectSchema)
})

const fileSchema = z.object({ version: z.literal(1), workspaces: z.array(workspaceSchema) })

let state: Workspace[] | null = null
const file = (): string => join(app.getPath('userData'), 'projects.json')

export function listWorkspaces(): Workspace[] {
  state ??= readJson(file(), fileSchema, () => ({ version: 1 as const, workspaces: [] })).workspaces
  return state
}

function save(workspaces: Workspace[]): void {
  state = workspaces
  writeJsonAtomic(file(), { version: 1, workspaces })
  broadcast(IPC.projectsChanged, workspaces)
}

export function findProject(id: string): { workspace: Workspace; project: Project } | undefined {
  for (const workspace of listWorkspaces()) {
    const project = workspace.projects.find((p) => p.id === id)
    if (project) return { workspace, project }
  }
  return undefined
}

/** True when `path` is a registered workspace folder or inside one. */
export function isInsideWorkspace(path: string): boolean {
  return listWorkspaces().some((w) => path === w.path || path.startsWith(w.path + sep))
}

/** Human label for a project: its path inside the workspace, or the workspace name for the root. */
export function projectLabel(workspace: Workspace, project: Project): string {
  return project.relPath || workspace.name
}

/** The most specific project containing `cwd`, for tagging ports with where they came from. */
export function resolveProjectForCwd(cwd: string): { id: string; name: string } | undefined {
  let best: { project: Project; workspace: Workspace } | undefined
  for (const workspace of listWorkspaces()) {
    for (const project of workspace.projects) {
      const inside = cwd === project.path || cwd.startsWith(project.path + sep)
      if (inside && (!best || project.path.length > best.project.path.length)) best = { project, workspace }
    }
  }
  return best ? { id: best.project.id, name: projectLabel(best.workspace, best.project) } : undefined
}

async function validateFolder(raw: string): Promise<string> {
  if (!isAbsolute(raw)) throw new Error('Choose a folder by its full path.')
  let real: string
  try {
    real = await realpath(raw)
    if (!(await stat(real)).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new Error('That folder does not exist or is not readable.')
  }
  if (real === '/' || real === homedir()) {
    throw new Error('That folder is too broad to scan. Pick the folder that holds your projects.')
  }
  return real
}

function build(path: string, real: Project[], req: Pick<AddWorkspaceRequest, 'excludedPaths' | 'trusted'>, prev?: Workspace): Workspace {
  const excluded = new Set(req.excludedPaths)
  return {
    id: projectId(path),
    name: basename(path),
    path,
    addedAt: prev?.addedAt ?? Date.now(),
    trusted: req.trusted,
    excludedPaths: req.excludedPaths,
    projects: real.filter((p) => !excluded.has(p.path))
  }
}

export async function previewFolder(raw: string): Promise<DiscoveryPreview> {
  const path = await validateFolder(raw)
  const { projects, truncated } = await discoverProjects(path)
  return {
    rootPath: path,
    name: basename(path),
    projects,
    truncated,
    alreadyAdded: listWorkspaces().some((w) => w.path === path)
  }
}

export async function addWorkspace(req: AddWorkspaceRequest): Promise<Workspace> {
  const path = await validateFolder(req.path)
  const existing = listWorkspaces()
  const inside = existing.find((w) => w.path !== path && path.startsWith(w.path + sep))
  if (inside) throw new Error(`Already covered by "${inside.name}". Rescan it to pick up new projects.`)

  const { projects } = await discoverProjects(path)
  const same = existing.find((w) => w.path === path)
  const workspace = build(path, projects, req, same)
  // Adding a parent absorbs workspaces that live inside it (their projects are now part of this one).
  const kept = existing.filter((w) => w.path !== path && !w.path.startsWith(path + sep))
  save([...kept, workspace].sort((a, b) => a.name.localeCompare(b.name)))
  return workspace
}

export function removeWorkspace(id: string): void {
  save(listWorkspaces().filter((w) => w.id !== id))
}

export async function rescanWorkspace(id: string): Promise<Workspace> {
  const prev = listWorkspaces().find((w) => w.id === id)
  if (!prev) throw new Error('That folder is no longer in Cairix.')
  // A deleted or unmounted folder must not silently wipe its project list.
  await validateFolder(prev.path)
  const { projects } = await discoverProjects(prev.path)
  const next = build(prev.path, projects, prev, prev)
  save(listWorkspaces().map((w) => (w.id === id ? next : w)))
  return next
}

export function setTrust(id: string, trusted: boolean): Workspace {
  const prev = listWorkspaces().find((w) => w.id === id)
  if (!prev) throw new Error('That folder is no longer in Cairix.')
  const next = { ...prev, trusted }
  save(listWorkspaces().map((w) => (w.id === id ? next : w)))
  return next
}
