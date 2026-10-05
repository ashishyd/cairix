import { z } from 'zod'
import { IPC } from '@shared/ipc'
import { handle } from '../../ipc'
import type { GitService } from './service'

const id = z.string().max(64)

export function registerGitHandlers(git: GitService): void {
  handle(IPC.gitState, z.tuple([id]), (p) => git.state(p))
  handle(IPC.gitCheckout, z.tuple([id, z.string().max(120)]), (p, b) => git.checkout(p, b))
  handle(IPC.gitCreateBranch, z.tuple([id, z.string().max(120)]), (p, n) => git.createBranch(p, n))
  handle(IPC.gitStash, z.tuple([id, z.enum(['push', 'pop', 'drop']), z.string().max(100).optional()]), (p, op, arg) => git.stash(p, op, arg))
  handle(IPC.gitCommit, z.tuple([id, z.string().max(5000), z.boolean()]), (p, m, all) => git.commit(p, m, all))
  handle(IPC.gitPush, z.tuple([id]), (p) => git.push(p))
  handle(IPC.gitPull, z.tuple([id]), (p) => git.pull(p))
  handle(IPC.gitFetch, z.tuple([id]), (p) => git.fetch(p))
  handle(IPC.gitPr, z.tuple([id]), (p) => git.pr(p))
}
