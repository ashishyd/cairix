import { randomUUID } from 'crypto'
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm, stat } from 'fs/promises'
import { dirname, join, relative } from 'path'
import { MANIFEST_FILE, type PluginManifest } from '@shared/plugins'
import { parseManifest } from './manifest'

/**
 * Installing means copying a folder somebody else wrote. It is treated as
 * hostile: no symlinks (they could point at your files), size and file-count
 * caps, and the folder name is derived from the validated manifest id, never
 * from anything the plugin controls on disk.
 */

export const MAX_TOTAL_BYTES = 5_000_000
export const MAX_FILES = 200
export const MAX_MAIN_BYTES = 500_000
const ID = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/

export class InstallError extends Error {}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string): Promise<void> => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, e.name)
      const st = await lstat(full)
      if (st.isSymbolicLink()) throw new InstallError(`The plugin contains a symbolic link (${relative(root, full)}). Symlinks are not allowed.`)
      if (st.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue // never shipped
        await walk(full)
      } else if (st.isFile()) out.push(full)
      if (out.length > MAX_FILES) throw new InstallError(`The plugin has more than ${MAX_FILES} files.`)
    }
  }
  await walk(root)
  return out
}

export async function readManifestFrom(folder: string): Promise<PluginManifest> {
  let raw: unknown
  try {
    raw = JSON.parse(await readFile(join(folder, MANIFEST_FILE), 'utf8'))
  } catch {
    throw new InstallError(`No valid ${MANIFEST_FILE} found in that folder.`)
  }
  const r = parseManifest(raw)
  if (!r.ok) throw new InstallError(`${MANIFEST_FILE}: ${r.error}`)
  return r.manifest
}

/** Validates `src` and copies it to `<pluginsDir>/<id>`, replacing a previous version. */
export async function installFromFolder(src: string, pluginsDir: string): Promise<PluginManifest> {
  let real: string
  try {
    real = await realpath(src)
    if (!(await stat(real)).isDirectory()) throw new Error()
  } catch {
    throw new InstallError('That is not a folder.')
  }
  const manifest = await readManifestFrom(real)
  if (!ID.test(manifest.id)) throw new InstallError('Invalid plugin id.')

  const files = await listFiles(real)
  let total = 0
  for (const f of files) total += (await stat(f)).size
  if (total > MAX_TOTAL_BYTES) throw new InstallError('The plugin is larger than 5 MB.')

  const main = join(real, manifest.main)
  if (relative(real, main).startsWith('..') || !files.includes(main)) throw new InstallError(`The main file "${manifest.main}" was not found in the plugin.`)
  if ((await stat(main)).size > MAX_MAIN_BYTES) throw new InstallError('The main file is larger than 500 KB.')

  const dest = join(pluginsDir, manifest.id)
  const tmp = join(pluginsDir, `.installing-${randomUUID().slice(0, 8)}`)
  await mkdir(tmp, { recursive: true })
  try {
    for (const f of files) {
      const target = join(tmp, relative(real, f))
      await mkdir(dirname(target), { recursive: true })
      await copyFile(f, target)
    }
    await rm(dest, { recursive: true, force: true })
    await rename(tmp, dest)
  } catch (e) {
    await rm(tmp, { recursive: true, force: true })
    throw e
  }
  return manifest
}

export interface InstalledPlugin {
  folder: string
  manifest?: PluginManifest
  error?: string
}

export async function listInstalled(pluginsDir: string): Promise<InstalledPlugin[]> {
  let names: string[]
  try {
    names = await readdir(pluginsDir)
  } catch {
    return []
  }
  const out: InstalledPlugin[] = []
  for (const name of names.filter((n) => !n.startsWith('.'))) {
    const folder = join(pluginsDir, name)
    try {
      const m = await readManifestFrom(folder)
      // The folder must be named for the manifest id, or a tampered copy could shadow another plugin.
      if (m.id !== name) throw new InstallError('The folder name does not match the plugin id.')
      out.push({ folder, manifest: m })
    } catch (e) {
      out.push({ folder, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}

export async function uninstall(pluginsDir: string, id: string): Promise<void> {
  if (!ID.test(id)) throw new InstallError('Invalid plugin id.')
  await rm(join(pluginsDir, id), { recursive: true, force: true })
}

export async function readMain(pluginsDir: string, manifest: PluginManifest): Promise<string> {
  const file = join(pluginsDir, manifest.id, manifest.main)
  if (relative(join(pluginsDir, manifest.id), file).startsWith('..')) throw new InstallError('Invalid main path.')
  return readFile(file, 'utf8')
}
