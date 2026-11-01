import { lstat } from 'fs/promises'
import { join } from 'path'
import type { SharedDepsApplyResult, SharedDepsReport, SharedPackageGroup } from '@shared/types'
import { CrossDeviceError, ensureStoreEntry, mergeInto, pruneStore } from './link'
import { packageKey, scanNodeModules, type FoundPackage } from './scan'

export interface SharedDepsDeps {
  projects(): Array<{ id: string; name: string; path: string; trusted: boolean }>
  isRunning(projectId: string): boolean
  /** Where shared copies live. Must be on the same disk as the projects. */
  storeDir: string
  /** Hide groups that would free less than this (KiB). */
  minKb?: number
}

interface Located extends FoundPackage {
  projectId: string
  projectName: string
  trusted: boolean
}

const kb = (bytes: number): number => Math.round(bytes / 1024)
const storeName = (name: string, version: string): string => `${name.replace('/', '+')}@${version}`

/**
 * Finds packages that are installed (same name and version) in more than one
 * project's node_modules and lets the user collapse them into one shared copy
 * on disk. Scanning is read-only; {@link apply} only swaps byte-identical files
 * for hard links inside trusted projects.
 */
export class SharedDepsService {
  private located = new Map<string, Located[]>()
  private scanning: Promise<SharedDepsReport> | undefined

  constructor(private readonly deps: SharedDepsDeps) {}

  scan(): Promise<SharedDepsReport> {
    this.scanning ??= this.doScan().finally(() => (this.scanning = undefined))
    return this.scanning
  }

  async apply(keys: string[]): Promise<SharedDepsApplyResult> {
    if (this.scanning) await this.scanning
    const applied: SharedDepsApplyResult['applied'] = []
    const skipped: SharedDepsApplyResult['skipped'] = []
    for (const key of new Set(keys)) {
      const copies = this.located.get(key)
      if (!copies) {
        skipped.push({ key, reason: 'Not found in the last scan. Scan again.' })
        continue
      }
      const eligible: Located[] = []
      for (const c of copies) {
        // Re-check: the scan may be old.
        if (!(await lstat(join(c.path, 'package.json')).then(() => true, () => false))) continue
        if (!c.trusted || this.deps.isRunning(c.projectId)) continue
        eligible.push(c)
      }
      if (eligible.length < 2) {
        skipped.push({ key, reason: 'Fewer than two copies are in trusted projects with nothing running.' })
        continue
      }
      try {
        const store = join(this.deps.storeDir, storeName(eligible[0].name, eligible[0].version))
        await ensureStoreEntry(store, eligible[0].path)
        let linkedFiles = 0
        let savedBytes = 0
        for (const c of eligible) {
          const r = await mergeInto(store, c.path)
          linkedFiles += r.linkedFiles
          savedBytes += r.savedBytes
        }
        applied.push({ key, linkedFiles, savedKb: kb(savedBytes) })
      } catch (e) {
        skipped.push({ key, reason: e instanceof CrossDeviceError ? e.message : (e as Error).message })
      }
    }
    return { applied, skipped, report: await this.scan() }
  }

  /** Deletes shared copies that no project uses any more. */
  async prune(): Promise<{ removed: number; freedKb: number }> {
    const r = await pruneStore(this.deps.storeDir)
    return { removed: r.removed, freedKb: kb(r.freedBytes) }
  }

  private async doScan(): Promise<SharedDepsReport> {
    const seen = new Set<string>()
    const all: Located[] = []
    const roots = new Set<string>()
    let projects = 0
    for (const p of this.deps.projects()) {
      const nm = join(p.path, 'node_modules')
      if (roots.has(nm)) continue
      roots.add(nm)
      const found = await scanNodeModules(nm, seen)
      if (found.length) projects++
      for (const f of found) all.push({ ...f, projectId: p.id, projectName: p.name, trusted: p.trusted })
    }

    const byKey = new Map<string, Located[]>()
    for (const f of all) byKey.set(packageKey(f.name, f.version), [...(byKey.get(packageKey(f.name, f.version)) ?? []), f])

    const min = this.deps.minKb ?? 16
    this.located = new Map()
    const groups: SharedPackageGroup[] = []
    for (const [key, copies] of byKey) {
      if (copies.length < 2) continue
      const total = copies.reduce((a, c) => a + c.bytes, 0)
      const reclaimable = total - Math.max(...copies.map((c) => c.bytes))
      if (kb(reclaimable) < min) continue
      this.located.set(key, copies)
      groups.push({
        key,
        name: copies[0].name,
        version: copies[0].version,
        sizeKb: kb(Math.max(...copies.map((c) => c.bytes))),
        reclaimableKb: kb(reclaimable),
        copies: copies.map((c) => ({ projectId: c.projectId, projectName: c.projectName, path: c.path, sizeKb: kb(c.bytes), trusted: c.trusted }))
      })
    }
    groups.sort((a, b) => b.reclaimableKb - a.reclaimableKb)
    return { ranAt: Date.now(), projects, packages: all.length, groups, reclaimableKb: groups.reduce((a, g) => a + g.reclaimableKb, 0), storeDir: this.deps.storeDir }
  }
}
