import { createHash, randomUUID } from 'crypto'
import { readFile } from 'fs/promises'
import { join } from 'path'
import type { AgentCli, ChangedFile, ChangesState, Finding, FixProposal } from '@shared/types'
import { readJson, writeJsonAtomic } from '../../json-store'
import { z } from 'zod'
import { buildReviewPrompt, CliError, diffForAi, parseReview, reviewArgs, runClaude, type RunClaudeOptions } from './ai'
import { quickFixPatch, runChecks } from './checks'
import { aiFix, applyPatch, checkPatch, patchFiles } from './fix'
import { readChanges, type RepoChanges } from './git'

export interface ChangesDeps {
  /** Resolves a project id to its folder, or undefined if it's gone/untrusted. */
  project(id: string): { path: string; trusted: boolean } | undefined
  dataDir: string
  detectClaude(): Promise<AgentCli>
  /** Every project Cairix knows, for the cross-project overview. */
  allProjects?(): Array<{ id: string; name: string; path: string; hasGit: boolean; trusted: boolean }>
  run?: (o: RunClaudeOptions) => ReturnType<typeof runClaude>
}

interface Cache {
  repo: RepoChanges
  checks: Finding[]
  ai?: { fingerprint: string; findings: Finding[]; costUsd?: number; at: number }
  aiError?: string
  reviewing: boolean
}

const dismissedFile = z.record(z.string(), z.array(z.string()))

export class ChangesService {
  private cache = new Map<string, Cache>()
  private proposals = new Map<string, FixProposal & { top: string; reverse?: boolean }>()
  private dismissed: Record<string, string[]>

  constructor(private readonly deps: ChangesDeps) {
    this.dismissed = readJson(join(deps.dataDir, 'changes-dismissed.json'), dismissedFile, () => ({}))
  }

  private root(projectId: string): { path: string; trusted: boolean } {
    const p = this.deps.project(projectId)
    if (!p) throw new Error('That project is no longer in Cairix.')
    return p
  }

  async get(projectId: string): Promise<ChangesState> {
    const { path } = this.root(projectId)
    const repo = await readChanges(path)
    const prev = this.cache.get(projectId)
    const entry: Cache = {
      repo,
      checks: runChecks(repo.files),
      ai: prev?.ai?.fingerprint === repo.fingerprint ? prev.ai : undefined,
      aiError: prev?.ai?.fingerprint === repo.fingerprint ? prev?.aiError : undefined,
      reviewing: prev?.reviewing ?? false
    }
    this.cache.set(projectId, entry)
    return this.toState(projectId, entry)
  }

  private async toState(projectId: string, c: Cache): Promise<ChangesState> {
    const hidden = new Set(this.dismissed[projectId] ?? [])
    const all = [...c.checks, ...(c.ai?.findings ?? [])]
    const seen = new Set<string>()
    const findings = all
      .filter((f) => !hidden.has(f.id) && !seen.has(f.id) && seen.add(f.id))
      .sort((a, b) => rank(a.severity) - rank(b.severity) || a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
    const byPath = new Map(c.repo.files.map((f) => [f.path, f]))
    const files: ChangedFile[] = c.repo.entries.map((e) => ({
      path: e.path,
      status: e.status,
      staged: e.staged,
      additions: byPath.get(e.path)?.additions ?? 0,
      deletions: byPath.get(e.path)?.deletions ?? 0
    }))
    const claude = await this.deps.detectClaude()
    return {
      projectId,
      isRepo: c.repo.isRepo,
      branch: c.repo.branch,
      files,
      fingerprint: c.repo.fingerprint,
      findings,
      dismissedCount: all.filter((f) => hidden.has(f.id)).length,
      ai: { available: claude.installed, reviewed: !!c.ai, reviewing: c.reviewing, error: c.aiError, costUsd: c.ai?.costUsd, at: c.ai?.at }
    }
  }

  /** The AI pass. Skipped (not failed) if there is nothing to review. */
  async review(projectId: string): Promise<ChangesState> {
    const { path } = this.root(projectId)
    await this.get(projectId)
    const c = this.cache.get(projectId)!
    if (!c.repo.isRepo || c.repo.files.length === 0 || c.reviewing) return this.toState(projectId, c)
    c.reviewing = true
    c.aiError = undefined
    const fingerprint = c.repo.fingerprint
    try {
      const diff = diffForAi(c.repo.diff, c.repo.files)
      if (!diff.trim()) throw new CliError('Only files that are not sent to the AI (such as .env or binary files) changed.')
      const result = await (this.deps.run ?? runClaude)({ prompt: buildReviewPrompt(diff), args: reviewArgs(), cwd: undefined })
      const changed = new Set(c.repo.files.map((f) => f.path))
      const findings = parseReview(result, changed, (file, title, line) => hash(`${file}|ai|${title}|${line ?? ''}`))
      // Drop AI findings that merely repeat an instant check on the same line.
      const dup = new Set(c.checks.map((f) => `${f.file}:${f.line}`))
      c.ai = { fingerprint, findings: findings.filter((f) => !(f.line && dup.has(`${f.file}:${f.line}`))), costUsd: result.costUsd, at: Date.now() }
    } catch (e) {
      c.aiError = e instanceof Error ? e.message : String(e)
    } finally {
      c.reviewing = false
    }
    void path
    return this.toState(projectId, c)
  }

  async dismiss(projectId: string, findingId: string): Promise<ChangesState> {
    this.root(projectId)
    this.dismissOnly(projectId, findingId)
    return this.get(projectId)
  }

  async fix(projectId: string, findingId: string): Promise<FixProposal> {
    await this.get(projectId)
    const c = this.cache.get(projectId)!
    const finding = [...c.checks, ...(c.ai?.findings ?? [])].find((f) => f.id === findingId)
    if (!finding) throw new Error('That finding is gone. The code may have changed; refresh the review.')
    return this.fixFinding(projectId, finding)
  }

  /**
   * Prepares a fix for any finding (from a review or an audit). Instant fixes
   * are built from the file as it is on disk right now; AI fixes run in a
   * throwaway copy. Nothing is applied until `apply`.
   */
  async fixFinding(projectId: string, finding: Finding): Promise<FixProposal> {
    const project = this.root(projectId)
    if (!project.trusted) throw new Error('Trust this folder before fixing code in it.')
    const repo = await readChanges(project.path)
    if (!repo.isRepo) throw new Error('Fixes need this folder to be a git repository.')
    const top = repo.top

    let patch: string
    let by: FixProposal['by']
    let costUsd: number | undefined
    if (finding.quickFix && finding.line) {
      const text = (await readFile(join(top, finding.file), 'utf8').catch(() => '')).split('\n')[finding.line - 1]
      const quick = text === undefined ? null : quickFixPatch(finding.file, finding.line, text, finding)
      if (!quick) throw new Error('That line has changed since the review. Refresh and try again.')
      patch = quick
      by = 'quick-fix'
    } else {
      const r = await aiFix({
        top,
        worktreesDir: join(this.deps.dataDir, 'worktrees'),
        changed: repo.entries.map((e) => ({ path: e.path, status: e.status })),
        finding,
        run: this.deps.run
      })
      patch = r.patch
      costUsd = r.costUsd
      by = 'claude'
    }
    await checkPatch(top, patch)
    const proposal = { id: randomUUID(), findingId: finding.id, projectId, patch, files: patchFiles(patch), by, costUsd, applied: false, top }
    this.proposals.set(proposal.id, proposal)
    return strip(proposal)
  }

  /**
   * Which projects have uncommitted work, and how bad it looks. Only trusted
   * git projects are read, a few at a time; nothing here calls the AI. Nested
   * projects of one repository are counted once, at the outermost project.
   */
  async overview(): Promise<import('@shared/types').ChangesOverviewItem[]> {
    const all = (this.deps.allProjects?.() ?? []).filter((p) => p.hasGit && p.trusted).slice(0, 60)
    const found: Array<{ top: string; isRoot: boolean; item: import('@shared/types').ChangesOverviewItem }> = []
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < all.length) {
        const p = all[next++]
        try {
          const repo = await readChanges(p.path)
          if (!repo.isRepo || repo.entries.length === 0) continue
          const hidden = new Set(this.dismissed[p.id] ?? [])
          const checks = runChecks(repo.files).filter((f) => !hidden.has(f.id))
          found.push({
            top: repo.top,
            isRoot: repo.top === p.path,
            item: { projectId: p.id, name: p.name, branch: repo.branch, files: repo.entries.length, errors: checks.filter((f) => f.severity === 'error').length, warnings: checks.filter((f) => f.severity === 'warning').length }
          })
        } catch {
          /* a project we can't read is simply not listed */
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()])
    // A repository whose root is itself a project already covers its nested projects.
    const rootTops = new Set(found.filter((f) => f.isRoot).map((f) => f.top))
    const out = found.filter((f) => f.isRoot || !rootTops.has(f.top)).map((f) => f.item)
    return out.sort((a, b) => b.errors - a.errors || b.warnings - a.warnings || b.files - a.files)
  }

  /** Registers a patch produced elsewhere (an agent task) so it uses the same checked apply / undo flow. */
  async registerProposal(projectId: string, sourceId: string, patch: string, by: FixProposal['by'], costUsd?: number): Promise<FixProposal> {
    const project = this.root(projectId)
    if (!project.trusted) throw new Error('Trust this folder before applying changes to it.')
    const repo = await readChanges(project.path)
    if (!repo.isRepo) throw new Error('Applying changes needs this folder to be a git repository.')
    await checkPatch(repo.top, patch)
    const proposal = { id: randomUUID(), findingId: sourceId, projectId, patch, files: patchFiles(patch), by, costUsd, applied: false, top: repo.top }
    this.proposals.set(proposal.id, proposal)
    return strip(proposal)
  }

  isDismissed(projectId: string, findingId: string): boolean {
    return (this.dismissed[projectId] ?? []).includes(findingId)
  }

  dismissOnly(projectId: string, findingId: string): void {
    this.dismissed[projectId] = [...new Set([...(this.dismissed[projectId] ?? []), findingId])]
    writeJsonAtomic(join(this.deps.dataDir, 'changes-dismissed.json'), this.dismissed)
  }

  async apply(proposalId: string): Promise<FixProposal> {
    const p = this.proposal(proposalId)
    if (p.applied) return strip(p)
    await applyPatch(p.top, p.patch)
    p.applied = true
    return strip(p)
  }

  async undo(proposalId: string): Promise<FixProposal> {
    const p = this.proposal(proposalId)
    if (!p.applied) return strip(p)
    await applyPatch(p.top, p.patch, true)
    p.applied = false
    return strip(p)
  }

  private proposal(id: string): FixProposal & { top: string } {
    const p = this.proposals.get(id)
    if (!p) throw new Error('That fix is no longer available. Prepare it again.')
    return p
  }
}

const rank = (s: string): number => (s === 'error' ? 0 : s === 'warning' ? 1 : 2)
const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 12)
const strip = (p: FixProposal & { top?: string }): FixProposal => {
  const { top: _top, ...rest } = p as FixProposal & { top?: string }
  void _top
  return rest
}
