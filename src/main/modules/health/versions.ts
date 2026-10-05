/** A small version-range matcher: enough for .nvmrc, engines.node, requires-python and friends. */

export interface Ver {
  major: number
  minor: number | null
  patch: number | null
}

/** First `1`, `1.2` or `1.2.3` in a string ("v20.11.0", "Python 3.11.4", "go1.22.1"). */
export function parseVer(text: string): Ver | null {
  const m = text.match(/(\d+)(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?/)
  if (!m) return null
  const num = (s: string | undefined): number | null => (s === undefined || /[xX*]/.test(s) ? null : +s)
  return { major: +m[1], minor: num(m[2]), patch: num(m[3]) }
}

const full = (v: Ver): [number, number, number] => [v.major, v.minor ?? 0, v.patch ?? 0]

function cmp(a: Ver, b: Ver): number {
  const x = full(a)
  const y = full(b)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
  return 0
}

/** Does `v` match a (possibly partial) version exactly on the parts that were given? ("20" matches 20.x.x) */
function matchesPrefix(v: Ver, want: Ver): boolean {
  if (v.major !== want.major) return false
  if (want.minor !== null && (v.minor ?? 0) !== want.minor) return false
  return want.patch === null || (v.patch ?? 0) === want.patch
}

function comparator(actual: Ver, token: string): boolean | null {
  const m = token.match(/^(>=|<=|>|<|=|\^|~)?\s*v?(.+)$/)
  if (!m) return null
  const want = parseVer(m[2])
  if (!want) return null
  switch (m[1]) {
    case '>=': return cmp(actual, want) >= 0
    case '>': return cmp(actual, want) > 0
    case '<=': return cmp(actual, want) <= 0
    case '<': return cmp(actual, want) < 0
    case '^':
      if (cmp(actual, want) < 0) return false
      return want.major > 0 || want.minor === null ? actual.major === want.major : actual.major === 0 && actual.minor === want.minor
    case '~':
      return cmp(actual, want) >= 0 && actual.major === want.major && (want.minor === null || actual.minor === want.minor)
    default:
      return matchesPrefix(actual, want)
  }
}

/**
 * Does the installed version satisfy what the project asks for?
 * true / false, or null when it cannot be decided (aliases like `lts/*`, forms we do not read).
 */
export function satisfies(actualText: string, wantedText: string): boolean | null {
  const actual = parseVer(actualText)
  if (!actual) return null
  const wanted = wantedText.trim().replace(/^v(?=\d)/, '')
  if (!wanted || /^(lts|node|stable|latest|system|current|\*)/i.test(wanted) || /\s-\s/.test(wanted)) return null
  // Python specifiers: "==3.11.*", "~=3.10", ">=3.9,<4"
  const normal = wanted.replace(/~=\s*/g, '^').replace(/==\s*/g, '=').replace(/,/g, ' ')
  let undecided = false
  for (const alt of normal.split('||')) {
    const tokens = alt.trim().split(/\s+/).filter(Boolean)
    // "> = 1" style spacing: glue a lone operator to the next token.
    const glued: string[] = []
    for (let i = 0; i < tokens.length; i++) glued.push(/^(>=|<=|>|<|=|\^|~)$/.test(tokens[i]) && tokens[i + 1] ? tokens[i] + tokens[++i] : tokens[i])
    const results = glued.map((t) => comparator(actual, t))
    if (results.some((r) => r === null)) {
      undecided = true
      continue
    }
    if (results.every(Boolean)) return true
  }
  return undecided ? null : false
}

/** First meaningful line of a version file (`.nvmrc`, `.python-version`): comments and blanks skipped. */
export function firstLine(text: string): string | undefined {
  return text.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'))
}

/** The version of `tool` from an asdf/mise `.tool-versions` file. */
export function toolVersion(text: string, ...names: string[]): string | undefined {
  for (const line of text.split('\n')) {
    const [name, version] = line.trim().split(/\s+/)
    if (name && version && names.includes(name)) return version
  }
  return undefined
}
