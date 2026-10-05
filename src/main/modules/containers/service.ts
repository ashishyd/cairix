import { redactTokens } from '@shared/redact'
import type { ContainerAction, ContainersSnapshot } from '@shared/types'
import { CONTAINER_ID, parseContainers, runDocker, type DockerResult } from './docker'

export interface ContainersDeps {
  run?(args: string[], opts?: { timeout?: number }): Promise<DockerResult>
  /** The Cairix project a Compose folder belongs to. */
  projectForFolder(path: string): { id: string; name: string } | undefined
}

const MAX_LOG_CHARS = 200_000

/**
 * Lists and controls Docker containers. Only three verbs exist (start, stop,
 * restart), and the id the UI sends is checked against a fresh `docker ps`
 * before anything runs, so the UI can never aim at a container that is not there.
 */
export class ContainersService {
  private readonly run: NonNullable<ContainersDeps['run']>
  constructor(private readonly deps: ContainersDeps) {
    this.run = deps.run ?? runDocker
  }

  async list(): Promise<ContainersSnapshot> {
    const at = Date.now()
    try {
      const { stdout } = await this.run(['ps', '-a', '--no-trunc', '--format', '{{json .}}'])
      const containers = parseContainers(stdout).map((c) => {
        const project = c.workingDir ? this.deps.projectForFolder(c.workingDir) : undefined
        return { ...c, id: c.id.slice(0, 12), projectId: project?.id, projectName: project?.name }
      })
      // Running first, then by Compose project and name: what you are using stays on top.
      containers.sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || Number(!!b.composeProject) - Number(!!a.composeProject) || (a.composeProject ?? '').localeCompare(b.composeProject ?? '') || a.name.localeCompare(b.name))
      return { at, available: true, containers }
    } catch (e) {
      const err = e as Error & { code?: string }
      if (err.code === 'ENOENT') return { at, available: false, reason: 'Docker is not installed.', containers: [] }
      if (/cannot connect|is the docker daemon running|daemon/i.test(err.message)) return { at, available: false, reason: 'Docker is installed but not running. Start Docker Desktop (or OrbStack).', containers: [] }
      return { at, available: false, reason: err.message || 'Docker did not answer.', containers: [] }
    }
  }

  async action(id: string, action: ContainerAction): Promise<ContainersSnapshot> {
    await this.mustExist(id)
    await this.run([action, id], { timeout: 60_000 })
    return this.list()
  }

  async logs(id: string, tail = 300): Promise<string> {
    await this.mustExist(id)
    const n = Math.min(Math.max(Math.trunc(tail) || 300, 10), 2000)
    // Containers write errors to stderr: show both, as `docker logs` does in a terminal.
    const { stdout, stderr } = await this.run(['logs', '--tail', String(n), '--timestamps', id], { timeout: 20_000 })
    const text = [stdout, stderr].filter(Boolean).join('')
    return redactTokens(text.length > MAX_LOG_CHARS ? '…' + text.slice(-MAX_LOG_CHARS) : text)
  }

  private async mustExist(id: string): Promise<void> {
    if (!CONTAINER_ID.test(id)) throw new Error('That is not a container id.')
    const snap = await this.list()
    if (!snap.available) throw new Error(snap.reason ?? 'Docker is not available.')
    if (!snap.containers.some((c) => c.id.startsWith(id) || id.startsWith(c.id))) throw new Error('That container no longer exists.')
  }
}
