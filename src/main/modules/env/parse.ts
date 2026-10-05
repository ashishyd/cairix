/**
 * A small, lossless `.env` reader/writer. Editing one variable must never
 * disturb comments, blank lines, ordering or other variables, so the file is
 * kept as a list of entries and only the touched one is rewritten.
 */

export type EnvEntry =
  | { kind: 'other'; raw: string }
  | { kind: 'var'; key: string; value: string; exported: boolean; raw: string }

const ASSIGN = /^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s?(.*)$/

function unescapeDouble(s: string): string {
  return s.replace(/\\(["\\nrt$])/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c === 't' ? '\t' : c))
}

/** Reads the value part of an assignment. `rest` starts right after `=`; returns the value and how many lines it spans. */
function readValue(rest: string, following: string[]): { value: string; extra: number } {
  const t = rest.trimStart()
  const q = t[0]
  if (q === '"' || q === "'") {
    // Quoted: runs to the matching quote, possibly over several lines.
    let body = t.slice(1)
    let extra = 0
    for (;;) {
      let i = 0
      let end = -1
      while (i < body.length) {
        if (q === '"' && body[i] === '\\') i += 2
        else if (body[i] === q) {
          end = i
          break
        } else i++
      }
      if (end >= 0) return { value: q === '"' ? unescapeDouble(body.slice(0, end)) : body.slice(0, end), extra }
      if (extra >= following.length) return { value: q === '"' ? unescapeDouble(body) : body, extra }
      body += '\n' + following[extra++]
    }
  }
  // Unquoted: an inline comment starts at whitespace + `#`.
  const hash = t.search(/\s#/)
  return { value: (hash >= 0 ? t.slice(0, hash) : t).trim(), extra: 0 }
}

export function parseEnv(text: string): EnvEntry[] {
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  const out: EnvEntry[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, '')
    const m = line.startsWith('#') ? null : line.match(ASSIGN)
    if (!m) {
      out.push({ kind: 'other', raw: lines[i] })
      continue
    }
    const { value, extra } = readValue(m[4], lines.slice(i + 1))
    out.push({ kind: 'var', key: m[3], value, exported: !!m[2], raw: lines.slice(i, i + 1 + extra).join('\n') })
    i += extra
  }
  return out
}

export function serializeEnv(entries: EnvEntry[]): string {
  return entries.length === 0 ? '' : entries.map((e) => e.raw).join('\n') + '\n'
}

/** Plain values are written bare; anything that could be misread gets double quotes. */
export function formatValue(value: string): string {
  if (value === '' || /^[A-Za-z0-9_./:@%+,=-]+$/.test(value)) return value
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(/\$/g, '\\$')}"`
}

export const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Sets (or adds) a variable, leaving every other line byte-for-byte as it was. */
export function setVar(entries: EnvEntry[], key: string, value: string): EnvEntry[] {
  if (!KEY_RE.test(key)) throw new Error('A variable name uses letters, digits and underscores, and does not start with a digit.')
  const line = (exported: boolean): string => `${exported ? 'export ' : ''}${key}=${formatValue(value)}`
  let found = false
  const next = entries.map((e) => {
    if (e.kind !== 'var' || e.key !== key || found) return e
    found = true
    return { ...e, value, raw: line(e.exported) }
  })
  return found ? next : [...next, { kind: 'var', key, value, exported: false, raw: line(false) }]
}

export function removeVar(entries: EnvEntry[], key: string): EnvEntry[] {
  return entries.filter((e) => !(e.kind === 'var' && e.key === key))
}

export function varsOf(entries: EnvEntry[]): Array<{ key: string; value: string }> {
  // The last assignment wins, like dotenv.
  const map = new Map<string, string>()
  for (const e of entries) if (e.kind === 'var') map.set(e.key, e.value)
  return [...map].map(([key, value]) => ({ key, value }))
}

/** The key's name suggests a secret. Used to flag and to never preview the value. */
export const SENSITIVE_KEY = /(KEY|TOKEN|SECRET|PASS(WORD|WD)?|PWD|CREDENTIAL|PRIVATE|AUTH|COOKIE|SALT|DSN|DATABASE_URL|CONNECTION|WEBHOOK)/i

export const isTemplateName = (name: string): boolean => /\.(example|sample|template|dist|defaults?)$/i.test(name)
export const ENV_FILE = /^\.env(\.[A-Za-z0-9][A-Za-z0-9._-]*)?$/
