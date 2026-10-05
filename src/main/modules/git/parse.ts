import type { GitBranch, GitCommitInfo, GitPullRequest, GitStash } from '@shared/types'

/** Parses `git status --porcelain=v2 --branch`. */
export function parseStatusV2(out: string): {
  branch: string | null
  detached?: string
  upstream?: string
  ahead: number
  behind: number
  staged: number
  changed: number
  untracked: number
  conflicted: number
} {
  const r = { branch: null as string | null, detached: undefined as string | undefined, upstream: undefined as string | undefined, ahead: 0, behind: 0, staged: 0, changed: 0, untracked: 0, conflicted: 0 }
  let oid = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.oid ')) oid = line.slice(13)
    else if (line.startsWith('# branch.head ')) {
      const head = line.slice(14)
      r.branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) r.upstream = line.slice(18)
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) {
        r.ahead = +m[1]
        r.behind = +m[2]
      }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const xy = line.split(' ')[1] ?? '..'
      if (xy[0] !== '.') r.staged++
      if (xy[1] !== '.') r.changed++
    } else if (line.startsWith('u ')) r.conflicted++
    else if (line.startsWith('? ')) r.untracked++
  }
  if (r.branch === null && oid && oid !== '(initial)') r.detached = oid.slice(0, 7)
  return r
}

/** `%(upstream:track,nobracket)` is "", "ahead 1", "behind 2", "ahead 1, behind 2" or "gone". */
export function parseTrack(track: string): { ahead: number; behind: number } {
  return { ahead: +(track.match(/ahead (\d+)/)?.[1] ?? 0), behind: +(track.match(/behind (\d+)/)?.[1] ?? 0) }
}

/** Parses the tab-separated output of `git for-each-ref refs/heads --format=...`. */
export function parseBranches(out: string): GitBranch[] {
  const list: GitBranch[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [name, upstream, track, when, subject, head] = line.split('\t')
    if (!name) continue
    list.push({ name, current: head === '*', upstream: upstream || undefined, ...parseTrack(track ?? ''), when: when || undefined, subject: subject || undefined })
  }
  return list
}

export function parseStashes(out: string): GitStash[] {
  const list: GitStash[] = []
  for (const line of out.split('\n')) {
    const m = line.match(/^stash@\{(\d+)\}\t(.*)$/)
    if (m) list.push({ index: +m[1], message: m[2] })
  }
  return list
}

export function parseLog(out: string): GitCommitInfo[] {
  return out
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [hash, subject, author, when] = l.split('\t')
      return { hash, subject: subject ?? '', author: author ?? '', when: when ?? '' }
    })
}

/** Branch names: what git allows, minus anything that could be read as an option or a path trick. */
export function isSafeBranchName(name: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(name) && !name.includes('..') && !name.endsWith('/') && !name.endsWith('.lock') && !name.includes('//')
}

interface RollupItem {
  __typename?: string
  status?: string
  conclusion?: string
  state?: string
}

/** Counts `gh pr view --json statusCheckRollup` entries (check runs and commit statuses). */
export function summarizeChecks(rollup: RollupItem[] | null | undefined): { passed: number; failed: number; pending: number } {
  const out = { passed: 0, failed: 0, pending: 0 }
  for (const c of rollup ?? []) {
    const verdict = (c.conclusion || c.state || '').toUpperCase()
    const status = (c.status || '').toUpperCase()
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(verdict)) out.passed++
    else if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(verdict)) out.failed++
    else if (verdict === 'PENDING' || verdict === 'EXPECTED' || ['IN_PROGRESS', 'QUEUED', 'WAITING', 'PENDING', 'REQUESTED'].includes(status) || verdict === '') out.pending++
  }
  return out
}

/** Reads `gh pr view --json number,title,url,state,isDraft,reviewDecision,statusCheckRollup`. */
export function parsePr(json: string): GitPullRequest | undefined {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(json) as Record<string, unknown>
  } catch {
    return undefined
  }
  if (typeof raw.number !== 'number' || typeof raw.url !== 'string') return undefined
  const review = typeof raw.reviewDecision === 'string' && raw.reviewDecision ? raw.reviewDecision : undefined
  return {
    number: raw.number,
    title: String(raw.title ?? ''),
    url: raw.url,
    state: String(raw.state ?? ''),
    isDraft: raw.isDraft === true,
    checks: summarizeChecks(raw.statusCheckRollup as RollupItem[] | undefined),
    review
  }
}
