/**
 * Pure parsers for shell history files. No I/O, so they are tested against
 * captured samples.
 */

export interface ParsedCommand {
  command: string
  /** Unix seconds, when the history format records it. */
  ts?: number
}

/**
 * zsh "metafies" bytes it treats specially (0x83 and a few control codes) by
 * prefixing 0x83 and XOR-ing the byte with 0x20. Anything non-ASCII in a
 * command (an accented filename, an emoji) is stored that way; undo it before
 * decoding as UTF-8.
 */
export function unmetafy(buf: Buffer): string {
  if (!buf.includes(0x83)) return buf.toString('utf8')
  const out: number[] = []
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x83 && i + 1 < buf.length) out.push(buf[++i] ^ 0x20)
    else out.push(buf[i])
  }
  return Buffer.from(out).toString('utf8')
}

/** Joins lines that end in a backslash (zsh stores multi-line commands that way). */
function joinContinuations(lines: string[], strip: (line: string) => string): string[] {
  const out: string[] = []
  let cur: string | null = null
  for (const raw of lines) {
    const line: string = cur === null ? strip(raw) : raw
    if (line.endsWith('\\')) {
      cur = (cur ?? '') + line.slice(0, -1) + '\n'
      continue
    }
    out.push((cur ?? '') + line)
    cur = null
  }
  if (cur !== null) out.push(cur.replace(/\n$/, ''))
  return out
}

/** zsh with EXTENDED_HISTORY (`: 1700000000:0;git status`) or plain lines. */
export function parseZsh(text: string): ParsedCommand[] {
  const stamps: Array<number | undefined> = []
  const joined = joinContinuations(text.split('\n'), (line) => {
    const m = line.match(/^: (\d+):\d+;(.*)$/)
    stamps.push(m ? Number.parseInt(m[1], 10) : undefined)
    return m ? m[2] : line
  })
  // `stamps` has one entry per *logical* command start, in order.
  return joined.map((command, i) => ({ command, ts: stamps[i] })).filter((c) => c.command.trim() !== '')
}

/** bash: one command per line, optionally preceded by `#<unix time>` when HISTTIMEFORMAT is set. */
export function parseBash(text: string): ParsedCommand[] {
  const out: ParsedCommand[] = []
  let ts: number | undefined
  for (const line of text.split('\n')) {
    const m = line.match(/^#(\d{9,11})$/)
    if (m) {
      ts = Number.parseInt(m[1], 10)
      continue
    }
    if (line.trim() !== '') out.push({ command: line, ts })
    ts = undefined
  }
  return out
}

/** fish: a tiny YAML-ish format: `- cmd: git status` followed by `  when: 1700000000`. */
export function parseFish(text: string): ParsedCommand[] {
  const out: ParsedCommand[] = []
  let cur: ParsedCommand | null = null
  for (const line of text.split('\n')) {
    const cmd = line.match(/^- cmd: (.*)$/)
    if (cmd) {
      if (cur) out.push(cur)
      cur = { command: cmd[1].replace(/\\n/g, '\n').replace(/\\\\/g, '\\') }
      continue
    }
    const when = line.match(/^\s+when: (\d+)$/)
    if (when && cur) cur.ts = Number.parseInt(when[1], 10)
  }
  if (cur) out.push(cur)
  return out.filter((c) => c.command.trim() !== '')
}

export type HistoryFormat = 'zsh' | 'bash' | 'fish'

export function parseHistory(text: string, format: HistoryFormat): ParsedCommand[] {
  return format === 'zsh' ? parseZsh(text) : format === 'fish' ? parseFish(text) : parseBash(text)
}
