import type { AgentCollision, AgentSession } from '@shared/types'

const MAX_FILES = 20

/** `git status --porcelain` → changed paths (renames keep the new name), capped so the snapshot stays small. */
export function parseDirty(porcelain: string): string[] {
  const files: string[] = []
  for (const line of porcelain.split('\n')) {
    if (line.length < 4) continue
    const path = line.slice(3)
    files.push(path.includes(' -> ') ? path.split(' -> ')[1] : path)
  }
  return files.slice(0, MAX_FILES)
}

/**
 * Repos where two or more live agents share one checkout. Worktrees have their
 * own root, so agents in separate worktrees never collide.
 * shortcut: git can't say which agent touched which file, so files are the repo's
 * dirty files; upgrade by diffing against a per-session baseline if that proves noisy.
 */
export function findCollisions(sessions: AgentSession[]): AgentCollision[] {
  const byRepo = new Map<string, AgentSession[]>()
  for (const s of sessions) {
    if (!s.repo) continue
    byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), s])
  }
  const out: AgentCollision[] = []
  for (const [repo, group] of byRepo) {
    if (group.length < 2) continue
    out.push({
      repo,
      projectName: group[0].projectName,
      sessionIds: group.map((s) => s.id),
      files: group[0].dirtyFiles ?? [],
      // Idle agents sharing a repo are only a heads-up; two working at once is the risk.
      severity: group.filter((s) => s.status !== 'idle').length >= 2 ? 'warning' : 'info'
    })
  }
  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1))
}
