import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { link, lstat, mkdir, readdir, rename, rm } from 'fs/promises'
import { dirname, join } from 'path'
import { listFiles } from './scan'

export class CrossDeviceError extends Error {
  constructor() {
    super('The shared store and this project are on different disks, so files cannot be shared.')
  }
}

export interface MergeResult {
  linkedFiles: number
  /** Disk bytes freed (files that were not shared with anything before). */
  savedBytes: number
  /** Files left alone because they differ from the shared copy. */
  skippedFiles: number
}

function sha256(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  })
}

/**
 * Makes `target` share disk space with `canonical` by replacing each file that
 * is byte-for-byte identical with a hard link. Each swap is a link to a temp
 * name followed by an atomic rename, so a crash never leaves a missing file,
 * and the folder looks exactly the same to Node (no symlinks, so module
 * resolution is unchanged). Files that differ (native builds, patched files)
 * are left alone.
 */
export async function mergeInto(canonical: string, target: string): Promise<MergeResult> {
  const result: MergeResult = { linkedFiles: 0, savedBytes: 0, skippedFiles: 0 }
  for (const rel of await listFiles(target)) {
    const t = join(target, rel)
    const c = join(canonical, rel)
    const [ts, cs] = await Promise.all([lstat(t).catch(() => null), lstat(c).catch(() => null)])
    if (!ts?.isFile() || !cs?.isFile()) {
      result.skippedFiles++
      continue
    }
    if (ts.dev !== cs.dev) throw new CrossDeviceError()
    if (ts.ino === cs.ino) continue // already shared
    if (ts.size !== cs.size || (ts.mode & 0o7777) !== (cs.mode & 0o7777) || (ts.size > 0 && (await sha256(t)) !== (await sha256(c)))) {
      result.skippedFiles++
      continue
    }
    const tmp = `${t}.cairix-tmp`
    try {
      await link(c, tmp)
      await rename(tmp, t)
    } catch (e) {
      await rm(tmp, { force: true })
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') throw new CrossDeviceError()
      throw e
    }
    result.linkedFiles++
    if (ts.nlink === 1) result.savedBytes += ts.blocks * 512
  }
  return result
}

async function linkTree(src: string, dest: string, rel = ''): Promise<void> {
  await mkdir(join(dest, rel), { recursive: true })
  for (const e of await readdir(join(src, rel), { withFileTypes: true })) {
    if (e.name === 'node_modules') continue
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) await linkTree(src, dest, r)
    else if (e.isFile()) await link(join(src, r), join(dest, r))
  }
}

/** Creates the shared copy of a package as hard links to `src`. A half-built store entry is never left behind. */
export async function ensureStoreEntry(store: string, src: string): Promise<void> {
  if (await lstat(store).then(() => true, () => false)) return
  const partial = `${store}.partial`
  await rm(partial, { recursive: true, force: true })
  await mkdir(dirname(store), { recursive: true })
  try {
    await linkTree(src, partial)
    await rename(partial, store)
  } catch (e) {
    await rm(partial, { recursive: true, force: true })
    if ((e as NodeJS.ErrnoException).code === 'EXDEV') throw new CrossDeviceError()
    throw e
  }
}

/** Store entries no project uses any more (every file has only the store's own link) cost disk for nothing. */
export async function pruneStore(root: string): Promise<{ removed: number; freedBytes: number }> {
  let removed = 0
  let freedBytes = 0
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (!e.isDirectory()) continue
    const dir = join(root, e.name)
    let bytes = 0
    let used = false
    for (const rel of await listFiles(dir)) {
      const st = await lstat(join(dir, rel)).catch(() => null)
      if (!st) continue
      if (st.nlink > 1) used = true
      bytes += st.blocks * 512
    }
    if (!used) {
      await rm(dir, { recursive: true, force: true })
      removed++
      freedBytes += bytes
    }
  }
  return { removed, freedBytes }
}
