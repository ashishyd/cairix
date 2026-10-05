import { execFile } from 'child_process'
import type { GitPrResult, GitState, GitStashOp } from '@shared/types'
import { spawnEnv } from '../../shell-env'
import { isSafeBranchName, parseBranches, parseLog, parsePr, parseStashes, parseStatusV2 } from './parse'

export interface GitDeps {
  project(id: string): { path: string; trusted: boolean; name: string; hasGit: boolean } | undefined
  /** Runs `git` in a folder; resolves with stdout and rejects with a readable message. Injectable for tests. */
  run?(cwd: string, args: string[], opts?: { timeout?: number }): Promise<string>
  /** Runs the GitHub CLI. Rejects with an Error that has `code` 'ENOENT' when it is not installed. */
  gh?(cwd: string, args: string[]): Promise<string>
}

/** Keeps the last few lines of git's complaint: the first line is often just "error:" noise. */
function explain(stderr: string, fallback: string): string {
  const lines = stderr.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('hint:'))
  return (lines.slice(-3).join(' ') || fallback).slice(0, 400)
}

export function runGit(cwd: string, args: string[], opts: { timeout?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    void spawnEnv({ GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' }).then((env) => {
      execFile('git', args, { cwd, env, timeout: opts.timeout ?? 30_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(explain(stderr || stdout, err.message)))
        else resolve(stdout)
      })
    })
  })
}

export function runGh(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    void spawnEnv({ GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }).then((env) => {
      execFile(process.env.CAIRIX_GH_BIN || 'gh', args, { cwd, env, timeout: 20_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error(explain(stderr || stdout, err.message)), { code: (err as NodeJS.ErrnoException).code }))
        else resolve(stdout)
      })
    })
  })
}

/**
 * Everyday git, without a terminal. The renderer names a project and a plain
 * operation; main builds the argv itself, so nothing the UI sends is ever
 * parsed as an option. No force, no rebase, no reset: operations that can lose
 * work stay in the terminal.
 */
export class GitService {
  private readonly run: NonNullable<GitDeps['run']>
  private readonly gh: NonNullable<GitDeps['gh']>

  constructor(private readonly deps: GitDeps) {
    this.run = deps.run ?? runGit
    this.gh = deps.gh ?? runGh
  }

  async state(projectId: string): Promise<GitState> {
    const p = this.project(projectId, false)
    const git = (args: string[]): Promise<string> => this.run(p.path, args).catch(() => '')
    const [status, refs, stashes, log, remotes, head] = await Promise.all([
      git(['status', '--porcelain=v2', '--branch']),
      git(['for-each-ref', '--sort=-committerdate', '--count=40', 'refs/heads', '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track,nobracket)%09%(committerdate:relative)%09%(contents:subject)%09%(HEAD)']),
      git(['stash', 'list', '--format=%gd%x09%gs']),
      git(['log', '-8', '--format=%h%x09%s%x09%an%x09%cr']),
      git(['remote']),
      this.run(p.path, ['rev-parse', '--verify', '-q', 'HEAD']).then(() => true, () => false)
    ])
    return {
      ...parseStatusV2(status),
      hasCommits: head,
      remote: remotes.split('\n').find(Boolean),
      branches: parseBranches(refs),
      stashes: parseStashes(stashes),
      recent: parseLog(log)
    }
  }

  async checkout(projectId: string, branch: string): Promise<GitState> {
    const p = this.project(projectId)
    const known = parseBranches(await this.run(p.path, ['for-each-ref', 'refs/heads', '--format=%(refname:short)%09%09%09%09%09%(HEAD)']))
    if (!known.some((b) => b.name === branch)) throw new Error(`There is no local branch called ${branch}.`)
    await this.run(p.path, ['switch', branch])
    return this.state(projectId)
  }

  async createBranch(projectId: string, name: string): Promise<GitState> {
    const p = this.project(projectId)
    if (!isSafeBranchName(name)) throw new Error('Use letters, digits, dots, dashes, underscores and slashes, starting with a letter or digit.')
    await this.run(p.path, ['check-ref-format', '--branch', name]).catch(() => {
      throw new Error(`"${name}" is not a valid branch name.`)
    })
    await this.run(p.path, ['switch', '-c', name])
    return this.state(projectId)
  }

  async stash(projectId: string, op: GitStashOp, arg?: string): Promise<GitState> {
    const p = this.project(projectId)
    if (op === 'push') {
      // -u: untracked files are part of "my work in progress" too.
      await this.run(p.path, ['stash', 'push', '-u', '-m', `Cairix: ${(arg ?? 'work in progress').replace(/[\r\n]+/g, ' ').slice(0, 80)}`])
    } else {
      if (arg !== undefined && !/^\d{1,3}$/.test(arg)) throw new Error('Invalid stash.')
      const ref = `stash@{${arg ?? '0'}}`
      await this.run(p.path, ['stash', op, ref])
    }
    return this.state(projectId)
  }

  async commit(projectId: string, message: string, all: boolean): Promise<GitState> {
    const p = this.project(projectId)
    const msg = message.trim()
    if (!msg) throw new Error('Write a commit message first.')
    if (msg.length > 5000) throw new Error('That commit message is too long.')
    const before = parseStatusV2(await this.run(p.path, ['status', '--porcelain=v2', '--branch']))
    if (before.conflicted > 0) throw new Error('Resolve the merge conflicts first.')
    if (all) await this.run(p.path, ['add', '-A'])
    else if (before.staged === 0) throw new Error('Nothing is staged. Tick “Include all changes” or stage files in your editor.')
    await this.run(p.path, ['commit', '-q', '-m', msg], { timeout: 120_000 }) // hooks (lint, tests) can be slow
    return this.state(projectId)
  }

  async push(projectId: string): Promise<GitState> {
    const p = this.project(projectId)
    const s = await this.state(projectId)
    if (!s.branch) throw new Error('You are not on a branch. Switch to one before pushing.')
    if (!s.hasCommits) throw new Error('There is nothing to push yet. Make a commit first.')
    if (s.upstream) await this.run(p.path, ['push'], { timeout: 120_000 })
    else {
      if (!s.remote) throw new Error('This repository has no remote to push to.')
      await this.run(p.path, ['push', '-u', s.remote, s.branch], { timeout: 120_000 })
    }
    return this.state(projectId)
  }

  async pull(projectId: string): Promise<GitState> {
    const p = this.project(projectId)
    const s = await this.state(projectId)
    if (!s.branch || !s.upstream) throw new Error('This branch does not track a remote branch yet. Push it first.')
    await this.run(p.path, ['pull', '--ff-only'], { timeout: 120_000 })
    return this.state(projectId)
  }

  async fetch(projectId: string): Promise<GitState> {
    const p = this.project(projectId)
    await this.run(p.path, ['fetch', '--prune'], { timeout: 120_000 })
    return this.state(projectId)
  }

  /** The pull request for the current branch, when `gh` is installed and signed in. Never throws for "not available". */
  async pr(projectId: string): Promise<GitPrResult> {
    const p = this.project(projectId, false)
    try {
      const out = await this.gh(p.path, ['pr', 'view', '--json', 'number,title,url,state,isDraft,reviewDecision,statusCheckRollup'])
      return { available: true, pr: parsePr(out) }
    } catch (e) {
      const err = e as Error & { code?: string }
      if (err.code === 'ENOENT') return { available: false, reason: 'Install the GitHub CLI (gh) to see pull requests and checks here.' }
      if (/gh auth login|not logged in|authentication/i.test(err.message)) return { available: false, reason: 'Run “gh auth login” in a terminal to see pull requests here.' }
      if (/no pull requests? found|could not find any pull request/i.test(err.message)) return { available: true }
      if (/none of the git remotes|not a github|no git remotes|unable to determine/i.test(err.message)) return { available: false, reason: 'This repository is not on GitHub.' }
      return { available: false, reason: err.message }
    }
  }

  private project(id: string, needTrust = true): { path: string; name: string } {
    const p = this.deps.project(id)
    if (!p) throw new Error('That project is no longer in Cairix.')
    if (!p.hasGit) throw new Error('This project is not a git repository.')
    if (needTrust && !p.trusted) throw new Error(`Trust "${p.name}" before changing its git state from Cairix.`)
    return p
  }
}
