import { describe, expect, it } from 'vitest'
import { isSafeBranchName, parseBranches, parseLog, parsePr, parseStashes, parseStatusV2, parseTrack, summarizeChecks } from '../src/main/modules/git/parse'
import { GitService, type GitDeps } from '../src/main/modules/git/service'

describe('parsing git output', () => {
  it('reads branch, upstream, ahead/behind and change counts from porcelain v2', () => {
    const out = ['# branch.oid abc123', '# branch.head main', '# branch.upstream origin/main', '# branch.ab +2 -1', '1 M. N... 100644 100644 100644 a b src/a.ts', '1 .M N... 100644 100644 100644 a b src/b.ts', '1 MM N... 100644 100644 100644 a b src/c.ts', 'u UU N... 1 1 1 1 a b c d.ts', '? new.txt', '? other.txt', ''].join('\n')
    expect(parseStatusV2(out)).toEqual({ branch: 'main', detached: undefined, upstream: 'origin/main', ahead: 2, behind: 1, staged: 2, changed: 2, untracked: 2, conflicted: 1 })
  })
  it('reads a detached HEAD and a brand-new repository', () => {
    expect(parseStatusV2('# branch.oid 1234567890abcdef\n# branch.head (detached)\n')).toMatchObject({ branch: null, detached: '1234567' })
    expect(parseStatusV2('# branch.oid (initial)\n# branch.head main\n')).toMatchObject({ branch: 'main', detached: undefined, ahead: 0 })
  })
  it('reads branch tracking text', () => {
    expect(parseTrack('')).toEqual({ ahead: 0, behind: 0 })
    expect(parseTrack('ahead 3')).toEqual({ ahead: 3, behind: 0 })
    expect(parseTrack('ahead 1, behind 4')).toEqual({ ahead: 1, behind: 4 })
    expect(parseTrack('gone')).toEqual({ ahead: 0, behind: 0 })
  })
  it('parses the branch list, stashes and log', () => {
    const b = parseBranches('main\torigin/main\tahead 1\t2 days ago\tFix thing\t*\nfeature/x\t\t\t3 weeks ago\tWIP\t \n')
    expect(b).toEqual([
      { name: 'main', current: true, upstream: 'origin/main', ahead: 1, behind: 0, when: '2 days ago', subject: 'Fix thing' },
      { name: 'feature/x', current: false, upstream: undefined, ahead: 0, behind: 0, when: '3 weeks ago', subject: 'WIP' }
    ])
    expect(parseStashes('stash@{0}\tWIP on main: abc Fix\nstash@{1}\tCairix: notes\n')).toEqual([{ index: 0, message: 'WIP on main: abc Fix' }, { index: 1, message: 'Cairix: notes' }])
    expect(parseLog('abc1234\tFix bug\tAda\t3 hours ago\n')).toEqual([{ hash: 'abc1234', subject: 'Fix bug', author: 'Ada', when: '3 hours ago' }])
  })
  it('only accepts branch names that cannot be mistaken for options or paths', () => {
    for (const ok of ['main', 'feature/login', 'fix-123', 'release_1.2']) expect(isSafeBranchName(ok), ok).toBe(true)
    for (const bad of ['-D', '--force', '../x', 'a..b', '/abs', 'trailing/', 'x.lock', 'a//b', '', 'has space', 'semi;colon', '$(x)']) expect(isSafeBranchName(bad), bad).toBe(false)
  })
})

describe('pull request checks', () => {
  it('counts passed, failed and running checks and statuses', () => {
    expect(summarizeChecks([{ conclusion: 'SUCCESS', status: 'COMPLETED' }, { conclusion: 'SKIPPED' }, { conclusion: 'FAILURE' }, { status: 'IN_PROGRESS' }, { state: 'SUCCESS' }, { state: 'PENDING' }, { conclusion: 'CANCELLED' }])).toEqual({ passed: 3, failed: 2, pending: 2 })
    expect(summarizeChecks(undefined)).toEqual({ passed: 0, failed: 0, pending: 0 })
  })
  it('parses gh output and rejects anything else', () => {
    const pr = parsePr(JSON.stringify({ number: 7, title: 'Add x', url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: true, reviewDecision: 'APPROVED', statusCheckRollup: [{ conclusion: 'SUCCESS' }] }))
    expect(pr).toEqual({ number: 7, title: 'Add x', url: 'https://github.com/o/r/pull/7', state: 'OPEN', isDraft: true, review: 'APPROVED', checks: { passed: 1, failed: 0, pending: 0 } })
    expect(parsePr('not json')).toBeUndefined()
    expect(parsePr('{}')).toBeUndefined()
  })
})

/** A scripted git: records every call and answers from a table. */
function fakeGit(over: Partial<{ trusted: boolean; hasGit: boolean; status: string; refs: string; remotes: string; head: boolean; fail: Record<string, string> }> = {}) {
  const calls: string[][] = []
  const deps: GitDeps = {
    project: (id) => (id === 'p' ? { path: '/repo', trusted: over.trusted ?? true, name: 'web', hasGit: over.hasGit ?? true } : undefined),
    run: async (_cwd, args) => {
      calls.push(args)
      const key = args.join(' ')
      const failure = Object.entries(over.fail ?? {}).find(([k]) => key.startsWith(k))
      if (failure) throw new Error(failure[1])
      if (args[0] === 'status') return over.status ?? '# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +0 -0\n1 M. N... 1 1 1 a b f.ts\n? n.txt\n'
      if (args[0] === 'for-each-ref') return over.refs ?? 'main\torigin/main\t\tnow\tmsg\t*\nfeature/a\t\t\tyesterday\tmsg\t \n'
      if (args[0] === 'remote') return over.remotes ?? 'origin\n'
      if (args[0] === 'rev-parse') return over.head === false ? Promise.reject(new Error('no HEAD')) : 'abc\n'
      return ''
    },
    gh: async () => '{}'
  }
  return { svc: new GitService(deps), calls, deps }
}
const mutating = (calls: string[][]): string[][] => calls.filter((c) => !['status', 'for-each-ref', 'stash list', 'log', 'remote', 'rev-parse'].includes(c[0] === 'stash' && c[1] === 'list' ? 'stash list' : c[0]))

describe('the git service', () => {
  it('reports branch state, branches and remote', async () => {
    const s = await fakeGit().svc.state('p')
    expect(s).toMatchObject({ branch: 'main', upstream: 'origin/main', staged: 1, untracked: 1, hasCommits: true, remote: 'origin' })
    expect(s.branches.map((b) => b.name)).toEqual(['main', 'feature/a'])
  })
  it('refuses a project that is not a repo or not trusted, but still reads the state of an untrusted one', async () => {
    await expect(fakeGit({ hasGit: false }).svc.state('p')).rejects.toThrow(/not a git repository/)
    await expect(fakeGit({ trusted: false }).svc.commit('p', 'x', true)).rejects.toThrow(/Trust/)
    await expect(fakeGit({ trusted: false }).svc.state('p')).resolves.toBeTruthy()
    await expect(fakeGit().svc.state('nope')).rejects.toThrow(/no longer in Cairix/)
  })
  it('switches only to a branch that exists locally', async () => {
    const f = fakeGit()
    await f.svc.checkout('p', 'feature/a')
    expect(mutating(f.calls)).toEqual([['switch', 'feature/a']])
    await expect(f.svc.checkout('p', '--orphan')).rejects.toThrow(/no local branch/)
    await expect(f.svc.checkout('p', 'nope')).rejects.toThrow(/no local branch/)
  })
  it('creates a branch only with a safe, valid name', async () => {
    const f = fakeGit()
    await f.svc.createBranch('p', 'feature/new-thing')
    expect(mutating(f.calls)).toEqual([['check-ref-format', '--branch', 'feature/new-thing'], ['switch', '-c', 'feature/new-thing']])
    await expect(f.svc.createBranch('p', '-bad')).rejects.toThrow(/letters, digits/)
    await expect(fakeGit({ fail: { 'check-ref-format': 'bad' } }).svc.createBranch('p', 'a..b')).rejects.toThrow()
    await expect(fakeGit({ fail: { 'check-ref-format': 'bad' } }).svc.createBranch('p', 'ok-name')).rejects.toThrow(/not a valid branch name/)
  })
  it('commits with the message as one argument, never through a shell', async () => {
    const f = fakeGit()
    await f.svc.commit('p', 'Fix "quotes" and $(rm -rf ~)', true)
    expect(mutating(f.calls)).toEqual([['add', '-A'], ['commit', '-q', '-m', 'Fix "quotes" and $(rm -rf ~)']])
  })
  it('will not commit with no message, no staged files (when not including all), or conflicts', async () => {
    await expect(fakeGit().svc.commit('p', '   ', true)).rejects.toThrow(/commit message/)
    await expect(fakeGit({ status: '# branch.head main\n' }).svc.commit('p', 'x', false)).rejects.toThrow(/Nothing is staged/)
    await expect(fakeGit({ status: '# branch.head main\nu UU N... 1 1 1 1 a b c f.ts\n' }).svc.commit('p', 'x', true)).rejects.toThrow(/conflicts/)
  })
  it('pushes the current branch only, publishing it the first time, and never forces', async () => {
    const f = fakeGit()
    await f.svc.push('p')
    expect(mutating(f.calls)).toEqual([['push']])
    const g = fakeGit({ status: '# branch.oid a\n# branch.head topic\n' })
    await g.svc.push('p')
    expect(mutating(g.calls)).toEqual([['push', '-u', 'origin', 'topic']])
    for (const c of [...f.calls, ...g.calls]) expect(c.join(' ')).not.toMatch(/--force|-f\b/)
    await expect(fakeGit({ status: '# branch.oid a\n# branch.head topic\n', remotes: '' }).svc.push('p')).rejects.toThrow(/no remote/)
    await expect(fakeGit({ status: '# branch.oid abc\n# branch.head (detached)\n' }).svc.push('p')).rejects.toThrow(/not on a branch/)
    await expect(fakeGit({ head: false }).svc.push('p')).rejects.toThrow(/nothing to push/)
  })
  it('pulls fast-forward only, and only when the branch tracks something', async () => {
    const f = fakeGit()
    await f.svc.pull('p')
    expect(mutating(f.calls)).toEqual([['pull', '--ff-only']])
    await expect(fakeGit({ status: '# branch.oid a\n# branch.head topic\n' }).svc.pull('p')).rejects.toThrow(/does not track/)
  })
  it('stashes with a safe message and validates the index to pop or drop', async () => {
    const f = fakeGit()
    await f.svc.stash('p', 'push', 'note\nwith newline')
    await f.svc.stash('p', 'pop', '2')
    await f.svc.stash('p', 'drop')
    expect(mutating(f.calls)).toEqual([['stash', 'push', '-u', '-m', 'Cairix: note with newline'], ['stash', 'pop', 'stash@{2}'], ['stash', 'drop', 'stash@{0}']])
    await expect(f.svc.stash('p', 'drop', '0; rm -rf ~')).rejects.toThrow(/Invalid stash/)
  })
  it('surfaces git\'s own explanation when something fails', async () => {
    await expect(fakeGit({ fail: { commit: 'Author identity unknown' } }).svc.commit('p', 'x', true)).rejects.toThrow('Author identity unknown')
  })
})

describe('the pull request lookup', () => {
  const withGh = (gh: GitDeps['gh']) => new GitService({ ...fakeGit().deps, gh })
  const err = (message: string, code?: string) => Object.assign(new Error(message), { code })
  it('returns the PR with its checks', async () => {
    const r = await withGh(async () => JSON.stringify({ number: 3, title: 't', url: 'https://x/3', state: 'OPEN', statusCheckRollup: [{ conclusion: 'FAILURE' }] })).pr('p')
    expect(r).toMatchObject({ available: true, pr: { number: 3, checks: { failed: 1 } } })
  })
  it('explains each way it can be unavailable without throwing', async () => {
    expect(await withGh(async () => { throw err('spawn gh ENOENT', 'ENOENT') }).pr('p')).toMatchObject({ available: false, reason: expect.stringContaining('Install the GitHub CLI') })
    expect(await withGh(async () => { throw err('To get started with GitHub CLI, please run: gh auth login') }).pr('p')).toMatchObject({ available: false, reason: expect.stringContaining('gh auth login') })
    expect(await withGh(async () => { throw err('no pull requests found for branch "x"') }).pr('p')).toEqual({ available: true })
    expect(await withGh(async () => { throw err('none of the git remotes configured for this repository point to a known GitHub host') }).pr('p')).toMatchObject({ available: false, reason: expect.stringContaining('not on GitHub') })
  })
})
