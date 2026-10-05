import { execFile } from 'child_process'
import { access } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { ContainerInfo } from '@shared/types'
import { spawnEnv } from '../../shell-env'

/** `k=v,k2=v2` as printed by `docker ps --format '{{.Labels}}'`. Values may contain commas, so split only before a `key=`. */
export function parseLabels(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!text) return out
  for (const part of text.split(/,(?=[A-Za-z0-9_.-]+=)/)) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1)
  }
  return out
}

/** Parses `docker ps -a --format '{{json .}}'`: one JSON object per line. Lines that are not JSON are skipped. */
export function parseContainers(out: string): ContainerInfo[] {
  const list: ContainerInfo[] = []
  for (const line of out.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let o: Record<string, string>
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!o.ID) continue
    const labels = parseLabels(o.Labels ?? '')
    list.push({
      id: o.ID,
      name: (o.Names ?? '').split(',')[0],
      image: o.Image ?? '',
      state: (o.State ?? '').toLowerCase(),
      status: o.Status ?? '',
      ports: o.Ports ?? '',
      composeProject: labels['com.docker.compose.project'] || undefined,
      composeService: labels['com.docker.compose.service'] || undefined,
      workingDir: labels['com.docker.compose.project.working_dir'] || undefined
    })
  }
  return list
}

export const CONTAINER_ID = /^[a-f0-9]{12,64}$/

let cached: Promise<string> | undefined

/** Where `docker` lives. A GUI app has a thin PATH, so also look in the usual install places. */
export function findDocker(): Promise<string> {
  cached ??= (async () => {
    if (process.env.CAIRIX_DOCKER_BIN) return process.env.CAIRIX_DOCKER_BIN
    for (const p of ['/usr/local/bin/docker', '/opt/homebrew/bin/docker', join(homedir(), '.docker/bin/docker'), '/Applications/Docker.app/Contents/Resources/bin/docker', '/Applications/OrbStack.app/Contents/MacOS/xbin/docker']) {
      try {
        await access(p)
        return p
      } catch {
        /* try the next */
      }
    }
    return 'docker' // fall back to PATH
  })()
  return cached
}

export interface DockerResult {
  stdout: string
  stderr: string
}

export function runDocker(args: string[], opts: { timeout?: number } = {}): Promise<DockerResult> {
  return new Promise((resolve, reject) => {
    void Promise.all([findDocker(), spawnEnv()]).then(([bin, env]) => {
      execFile(bin, args, { env, timeout: opts.timeout ?? 15_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(Object.assign(new Error((stderr || err.message).trim().split('\n').slice(-2).join(' ').slice(0, 300)), { code: (err as NodeJS.ErrnoException).code }))
        else resolve({ stdout, stderr })
      })
    })
  })
}
