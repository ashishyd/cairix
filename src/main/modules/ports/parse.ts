/**
 * Pure parsers for the output of `lsof` and `ps`. Kept free of child_process
 * and Electron so they can be tested against captured output.
 */

// ───────────────────────── lsof ─────────────────────────

export interface Listener {
  pid: number
  /** Full command name (we pass `+c 0` so lsof doesn't truncate to 9 chars). */
  name: string
  user: string
  port: number
  /** `*`, `127.0.0.1`, `[::1]` ... */
  address: string
}

/**
 * Parses `lsof +c 0 -nP -iTCP -sTCP:LISTEN -F pcLn`.
 *
 * `-F` output is one field per line, prefixed by a letter: `p` starts a
 * process set (pid), `c` is its command, `L` its login; each `f` starts a file
 * set whose `n` is the socket name like `*:3000` or `[::1]:3000`. A process
 * listening on IPv4 and IPv6 yields two sockets for the same port, which are
 * merged, preferring the widest bind address since that decides exposure.
 */
export function parseLsofListeners(output: string): Listener[] {
  const found = new Map<string, Listener>()
  let pid = 0
  let name = ''
  let user = ''
  for (const line of output.split('\n')) {
    if (!line) continue
    const tag = line[0]
    const value = line.slice(1)
    if (tag === 'p') {
      pid = Number.parseInt(value, 10)
      name = ''
      user = ''
    } else if (tag === 'c') name = decodeLsof(value)
    else if (tag === 'L') user = value
    else if (tag === 'n' && pid > 0) {
      // `*:3000`, `127.0.0.1:3000`, `[::1]:3000`; anything with `->` is a connection, not a listener
      if (value.includes('->')) continue
      const colon = value.lastIndexOf(':')
      if (colon < 0) continue
      const port = Number.parseInt(value.slice(colon + 1), 10)
      if (!Number.isInteger(port) || port <= 0 || port > 65535) continue
      const address = value.slice(0, colon)
      const key = `${pid}:${port}`
      const existing = found.get(key)
      if (!existing) found.set(key, { pid, name, user, port, address })
      else if (rank(address) > rank(existing.address)) existing.address = address
    }
  }
  return [...found.values()]
}

/** lsof escapes spaces and control characters as \xNN. */
function decodeLsof(s: string): string {
  return s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))
}

/** Wider binds win when merging IPv4/IPv6 sockets of the same port. */
function rank(address: string): number {
  if (address === '*' || address === '0.0.0.0' || address === '[::]') return 3
  return isLoopback(address) ? 1 : 2
}

export function isLoopback(address: string): boolean {
  return address === '127.0.0.1' || address === '[::1]' || address === 'localhost' || address.startsWith('127.')
}

export function isExposed(address: string): boolean {
  return !isLoopback(address)
}

/** Parses `lsof -a -d cwd -p <pids> -Fpn` into pid -> working directory. */
export function parseLsofCwd(output: string): Map<number, string> {
  const map = new Map<number, string>()
  let pid = 0
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number.parseInt(line.slice(1), 10)
    else if (line.startsWith('n') && pid > 0) map.set(pid, decodeLsof(line.slice(1)))
  }
  return map
}

// ───────────────────────── ps ─────────────────────────

export interface Proc {
  pid: number
  ppid: number
  pgid: number
  rssKb: number
  cpu: number
  uptimeSec: number
  /** Full command line including arguments. */
  command: string
}

/** `[[dd-]hh:]mm:ss` -> seconds. */
export function parseEtime(etime: string): number {
  const m = etime.trim().match(/^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/)
  if (!m) return 0
  const [, d = '0', h = '0', min, s] = m
  return (+d * 24 + +h) * 3600 + +min * 60 + +s
}

/** Parses `ps -axo pid=,ppid=,pgid=,rss=,pcpu=,etime=,command=`. */
export function parsePs(output: string): Proc[] {
  const procs: Proc[] = []
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/)
    if (!m) continue
    procs.push({
      pid: +m[1],
      ppid: +m[2],
      pgid: +m[3],
      rssKb: +m[4],
      cpu: Number.parseFloat(m[5]),
      uptimeSec: parseEtime(m[6]),
      command: m[7]
    })
  }
  return procs
}

// ───────────────────────── docker ─────────────────────────

/**
 * Parses `docker ps --format '{{.Names}}\t{{.Ports}}'` into hostPort -> container name.
 * Ports look like `0.0.0.0:5432->5432/tcp, :::5432->5432/tcp, 9000/tcp`.
 */
export function parseDockerPorts(output: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of output.split('\n')) {
    const [name, ports] = line.split('\t')
    if (!name || !ports) continue
    for (const m of ports.matchAll(/(?:[\d.]+|\[?::\]?):(\d+)(?:-(\d+))?->/g)) {
      const from = +m[1]
      const to = m[2] ? +m[2] : from
      for (let p = from; p <= to && p - from < 1000; p++) map.set(p, name)
    }
  }
  return map
}
