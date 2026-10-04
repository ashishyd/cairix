import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'

/** Builds a throw-away directory tree from `{ 'relative/path': 'file contents' }`. */
export function makeTree(files: Record<string, string>): { root: string; cleanup: () => void } {
  // realpath: on macOS os.tmpdir() is a symlink (/var -> /private/var) and
  // discovery reports real paths.
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-test-')))
  for (const [rel, content] of Object.entries(files)) {
    const file = join(root, rel)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content)
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export function link(target: string, path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  symlinkSync(target, path)
}

export const json = (o: unknown): string => JSON.stringify(o, null, 2)
