/** Parses `git diff` output into the lines that were ADDED, with their new line numbers. */

export interface AddedLine {
  line: number
  text: string
}

export interface DiffFile {
  path: string
  added: AddedLine[]
  additions: number
  deletions: number
  binary: boolean
  isNew: boolean
}

export function parseDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = []
  let cur: DiffFile | null = null
  let next = 0
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      cur = { path: '', added: [], additions: 0, deletions: 0, binary: false, isNew: false }
      files.push(cur)
      const m = raw.match(/ b\/(.+)$/)
      if (m) cur.path = m[1]
      continue
    }
    if (!cur) continue
    if (raw.startsWith('new file mode')) cur.isNew = true
    else if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) cur.binary = true
    else if (raw.startsWith('+++ ')) {
      const p = raw.slice(4)
      if (p !== '/dev/null') cur.path = p.replace(/^b\//, '')
    } else if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)(?:,\d+)?/)
      next = m ? Number(m[1]) : 0
    } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
      cur.added.push({ line: next++, text: raw.slice(1) })
      cur.additions++
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      cur.deletions++
    } else if (raw.startsWith(' ')) {
      next++
    }
  }
  return files.filter((f) => f.path)
}

/** An untracked file has no diff; treat every line as added. */
export function wholeFileAsAdded(path: string, content: string): DiffFile {
  const lines = content.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return { path, added: lines.map((text, i) => ({ line: i + 1, text })), additions: lines.length, deletions: 0, binary: false, isNew: true }
}
