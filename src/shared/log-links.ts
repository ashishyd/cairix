/** Finds `file:line:col` references in a line of terminal output, so stack traces can be clicked. */

export interface FileRef {
  /** Offsets into the line: start inclusive, end exclusive. */
  start: number
  end: number
  path: string
  line?: number
  column?: number
}

const EXT = 'tsx?|jsx?|mjs|cjs|mts|cts|vue|svelte|astro|py|rb|go|rs|java|kt|swift|php|cs|cc|cpp|c|h|hpp|css|scss|json|ya?ml|md|html|sh'
// path (absolute, ./, ../ or relative) ending in a known extension, then optional :line and :col.
const PATH_REF = new RegExp(`(?<![\\w/.:@-])((?:/|\\.{1,2}/)?(?:[\\w@.+~-]+/)*[\\w@.+~-]+\\.(?:${EXT}))(?::(\\d+))?(?::(\\d+))?(?![\\w/])`, 'g')
// Python: File "/x/y.py", line 12
const PY_REF = /File "([^"\n]+)", line (\d+)/g

export function findFileRefs(text: string): FileRef[] {
  const out: FileRef[] = []
  for (const m of text.matchAll(PY_REF)) {
    const start = m.index! + m[0].indexOf('"') + 1
    out.push({ start, end: m.index! + m[0].length, path: m[1], line: +m[2] })
  }
  for (const m of text.matchAll(PATH_REF)) {
    const start = m.index!
    const end = start + m[0].length
    if (out.some((r) => start < r.end && end > r.start)) continue
    out.push({ start, end, path: m[1], line: m[2] ? +m[2] : undefined, column: m[3] ? +m[3] : undefined })
  }
  return out.sort((a, b) => a.start - b.start)
}
