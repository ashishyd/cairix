import { execFile } from 'child_process'
import { getResolvedPath } from '../../shell-env'
import { parseDockerPorts } from './parse'

/**
 * Host port -> container name via `docker ps`, so a Docker-published port can
 * say which container owns it. Docker is optional: when the CLI is missing or
 * the daemon is stopped (the usual case) this resolves to an empty map in well
 * under a second and is cached so a stopped daemon isn't re-probed every scan.
 */
let cache: { at: number; map: Map<number, string> } | null = null
const TTL_MS = 5000

export async function dockerPorts(): Promise<Map<number, string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map
  const PATH = (await getResolvedPath()) ?? process.env.PATH
  const map = await new Promise<Map<number, string>>((resolve) => {
    execFile(
      'docker',
      ['ps', '--format', '{{.Names}}\t{{.Ports}}'],
      { timeout: 1500, env: { ...process.env, PATH } },
      (err, stdout) => resolve(err ? new Map() : parseDockerPorts(stdout))
    )
  })
  cache = { at: Date.now(), map }
  return map
}
