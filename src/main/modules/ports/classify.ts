import type { PortCategory } from '@shared/types'

/**
 * Decides what a listening process *is* so the UI can label it, group it and,
 * most importantly, refuse to offer a kill button for things that must not be
 * killed. Pure functions over the command line; no I/O.
 */

interface FrameworkRule {
  label: string
  /** Matched against the full command line. */
  re: RegExp
  category: PortCategory
}

// Order matters: first match wins, so specific tools come before generic runtimes.
const FRAMEWORKS: FrameworkRule[] = [
  { label: 'Next.js', re: /\bnext(-server|\s+(dev|start))|[/\\]next[/\\]dist/, category: 'dev' },
  { label: 'Nuxt', re: /\bnuxi?\b.*\b(dev|preview)|[/\\]\.nuxt[/\\]/, category: 'dev' },
  { label: 'Astro', re: /\bastro\b.*\b(dev|preview)/, category: 'dev' },
  { label: 'Remix', re: /\bremix(-serve|\s+dev)/, category: 'dev' },
  { label: 'Storybook', re: /\bstorybook\b|[/\\]storybook[/\\]/, category: 'dev' },
  { label: 'Vite', re: /[/\\]vite[/\\]|\bvite(\.js)?(\s|$)|\bvite\s+(dev|preview)/, category: 'dev' },
  { label: 'Webpack', re: /webpack(-dev-server|\s+serve)/, category: 'dev' },
  { label: 'Angular', re: /\bng\s+serve|@angular[/\\]cli/, category: 'dev' },
  { label: 'Expo / Metro', re: /\bexpo(-cli)?\b.*\bstart|\bmetro\b|react-native.*\bstart/, category: 'dev' },
  { label: 'Nodemon', re: /\bnodemon\b/, category: 'dev' },
  { label: 'tsx', re: /[/\\]tsx[/\\]|\btsx\s+(watch|\S+\.ts)/, category: 'dev' },
  { label: 'Electron', re: /Electron(\.app|\s|$)|electron-vite/, category: 'dev' },
  { label: 'Uvicorn', re: /\buvicorn\b/, category: 'dev' },
  { label: 'Gunicorn', re: /\bgunicorn\b/, category: 'dev' },
  { label: 'Flask', re: /\bflask\b.*\brun\b|\bflask\s+run/, category: 'dev' },
  { label: 'Django', re: /manage\.py\s+runserver/, category: 'dev' },
  { label: 'Streamlit', re: /\bstreamlit\b/, category: 'dev' },
  { label: 'Jupyter', re: /\bjupyter(-lab|-notebook|lab|\s+(lab|notebook))?\b/, category: 'dev' },
  { label: 'Python http.server', re: /http\.server/, category: 'dev' },
  { label: 'Rails / Puma', re: /\bpuma\b|\brails\s+(s|server)\b/, category: 'dev' },
  { label: 'PHP server', re: /\bphp(-fpm)?\b.*\s-S\s/, category: 'dev' },
  { label: 'Hugo', re: /\bhugo\s+server/, category: 'dev' },
  { label: 'Go', re: /[/\\]go-build[/\\]/, category: 'dev' },
  { label: 'Cargo', re: /[/\\]target[/\\](debug|release)[/\\]/, category: 'dev' },
  // databases and services
  { label: 'PostgreSQL', re: /\bpostgres(ql)?\b/, category: 'database' },
  { label: 'MySQL', re: /\bmysqld\b|\bmariadbd\b/, category: 'database' },
  { label: 'MongoDB', re: /\bmongod\b/, category: 'database' },
  { label: 'Redis', re: /\bredis-server\b|\bvalkey-server\b/, category: 'database' },
  { label: 'Memcached', re: /\bmemcached\b/, category: 'database' },
  { label: 'ClickHouse', re: /\bclickhouse/, category: 'database' },
  { label: 'Elasticsearch', re: /\belasticsearch\b/, category: 'database' },
  { label: 'MinIO', re: /\bminio\b/, category: 'database' },
  // generic runtimes last
  { label: 'Node.js', re: /(^|[/\\])node(\s|$)/, category: 'dev' },
  { label: 'Python', re: /(^|[/\\])python[\d.]*(\s|$)|Python\.app/, category: 'dev' },
  { label: 'Ruby', re: /(^|[/\\])ruby(\s|$)/, category: 'dev' },
  { label: 'Bun', re: /(^|[/\\])bun(\s|$)/, category: 'dev' },
  { label: 'Deno', re: /(^|[/\\])deno(\s|$)/, category: 'dev' },
  { label: 'Java', re: /(^|[/\\])java(\s|$)/, category: 'dev' }
]

export interface Classification {
  framework?: string
  category: PortCategory
}

export function classify(command: string): Classification {
  for (const rule of FRAMEWORKS) {
    if (rule.re.test(command)) return { framework: rule.label, category: rule.category }
  }
  return { category: 'other' }
}

// ───────────────────────── protection ─────────────────────────

/**
 * Paths owned by macOS itself. Killing these breaks the OS, not a dev server.
 * Deliberately NOT listed: /usr/bin and /usr/sbin. Apple's /usr/bin/python3
 * is a perfectly normal way to run `python3 -m http.server`, and root-owned
 * daemons in those folders are already caught by the ownership check.
 */
const SYSTEM_PREFIXES = ['/System/', '/usr/libexec/', '/sbin/', '/Library/Apple/', '/Library/PrivilegedHelperTools/']

/** Docker/VM plumbing: killing the proxy breaks every container, so stop the container instead. */
const CONTAINER_INFRA = /com\.docker|docker-proxy|vpnkit|OrbStack|colima|limactl/i

export interface Protection {
  protected: boolean
  reason?: string
}

export interface ProtectionContext {
  pid: number
  command: string
  /** Pids that make up Cairix itself (own pid and ancestors). */
  selfPids: ReadonlySet<number>
  /** Login name of the user running Cairix. */
  currentUser: string
  user: string
}

export function protection(ctx: ProtectionContext): Protection {
  if (ctx.pid <= 1) return { protected: true, reason: 'System process (launchd)' }
  if (ctx.selfPids.has(ctx.pid)) return { protected: true, reason: 'This is Cairix itself' }
  if (ctx.user && ctx.user !== ctx.currentUser) {
    return { protected: true, reason: `Owned by ${ctx.user}; Cairix only manages your own processes` }
  }
  if (SYSTEM_PREFIXES.some((p) => ctx.command.startsWith(p))) {
    return { protected: true, reason: 'Part of macOS' }
  }
  if (CONTAINER_INFRA.test(ctx.command)) {
    return { protected: true, reason: 'Docker infrastructure: stop the container instead' }
  }
  return { protected: false }
}

// ───────────────────────── hints ─────────────────────────

/**
 * Friendly explanations for the surprises developers actually hit. Since
 * macOS Monterey the AirPlay Receiver squats on 5000 and 7000, which breaks
 * Flask/Rails defaults ("Address already in use") with a process you can't kill.
 */
export function portHint(port: number, command: string): string | undefined {
  if ((port === 5000 || port === 7000) && /ControlCenter/.test(command)) {
    return 'macOS AirPlay Receiver. Turn it off in System Settings → General → AirDrop & Handoff.'
  }
  if (/rapportd/.test(command)) return 'macOS Handoff / Continuity service.'
  if (CONTAINER_INFRA.test(command)) {
    return 'Published by Docker. Stop the container instead of killing this process.'
  }
  return undefined
}
