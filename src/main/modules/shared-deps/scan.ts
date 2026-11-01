import { lstat, readdir, readFile } from 'fs/promises'
import { join } from 'path'

/** One installed copy of a package inside some project's node_modules. */
export interface FoundPackage {
  name: string
  version: string
  /** Absolute path of the package folder. */
  path: string
  /** Disk bytes this copy holds that no earlier copy in the same scan already holds (hard links count once). */
  bytes: number
}

// These end up in folder names of the shared store, so they must not be able to escape it.
const NAME = /^(@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/
const VERSION = /^\d+\.\d+\.\d+[0-9A-Za-z.+-]*$/

export const packageKey = (name: string, version: string): string => `${name}@${version}`

/** Files and folders of a package, not descending into its own nested node_modules (those are packages themselves). */
export async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = []
  for (const e of await readdir(join(dir, rel), { withFileTypes: true }).catch(() => [])) {
    if (e.name === 'node_modules') continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) out.push(...(await listFiles(dir, r)))
    else if (e.isFile()) out.push(r)
  }
  return out
}

async function measure(dir: string, seen: Set<string>): Promise<number> {
  let bytes = 0
  for (const rel of await listFiles(dir)) {
    const st = await lstat(join(dir, rel)).catch(() => null)
    if (!st) continue
    if (st.nlink > 1) {
      const id = `${st.dev}:${st.ino}`
      if (seen.has(id)) continue
      seen.add(id)
    }
    bytes += st.blocks * 512
  }
  return bytes
}

async function readPackage(dir: string, expected: string): Promise<{ name: string; version: string } | undefined> {
  try {
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
    // An aliased install (folder name differs from the real name) is not safe to treat as that package.
    if (pkg.name !== expected || typeof pkg.version !== 'string') return undefined
    if (!NAME.test(pkg.name) || !VERSION.test(pkg.version)) return undefined
    return { name: pkg.name, version: pkg.version }
  } catch {
    return undefined
  }
}

/**
 * Lists every real (non-symlink) package under a node_modules folder, including
 * the ones nested inside other packages. pnpm's symlinked layout is skipped on
 * purpose: it is already shared.
 */
export async function scanNodeModules(nm: string, seen: Set<string>, out: FoundPackage[] = []): Promise<FoundPackage[]> {
  const entries = await readdir(nm, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.name.startsWith('.') || !e.isDirectory()) continue // isDirectory() is false for symlinks
    const dirs = e.name.startsWith('@')
      ? (await readdir(join(nm, e.name), { withFileTypes: true }).catch(() => [])).filter((c) => c.isDirectory()).map((c) => ({ path: join(nm, e.name, c.name), expected: `${e.name}/${c.name}` }))
      : [{ path: join(nm, e.name), expected: e.name }]
    for (const d of dirs) {
      const pkg = await readPackage(d.path, d.expected)
      if (!pkg) continue
      out.push({ ...pkg, path: d.path, bytes: await measure(d.path, seen) })
      await scanNodeModules(join(d.path, 'node_modules'), seen, out)
    }
  }
  return out
}
