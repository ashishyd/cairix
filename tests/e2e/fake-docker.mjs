#!/usr/bin/env node
// A stand-in for the `docker` CLI: keeps containers in a JSON file so start/stop/restart really change what `ps` shows.
import { readFileSync, writeFileSync } from 'fs'

const file = process.env.CAIRIX_FAKE_DOCKER_STATE
const args = process.argv.slice(2)
const load = () => JSON.parse(readFileSync(file, 'utf8'))
const save = (list) => writeFileSync(file, JSON.stringify(list))

if (args[0] === 'ps') {
  for (const c of load()) console.log(JSON.stringify(c))
} else if (['start', 'stop', 'restart'].includes(args[0])) {
  const list = load()
  const c = list.find((x) => x.ID === args[1])
  if (!c) {
    console.error(`Error response from daemon: No such container: ${args[1]}`)
    process.exit(1)
  }
  c.State = args[0] === 'stop' ? 'exited' : 'running'
  c.Status = args[0] === 'stop' ? 'Exited (0) just now' : 'Up Less than a second'
  save(list)
} else if (args[0] === 'logs') {
  console.log('2025-01-01T00:00:00Z listening on 3000')
  console.log('2025-01-01T00:00:01Z using token ghp_abcdefghijklmnopqrstuvwxyz0123456789')
  console.error('2025-01-01T00:00:02Z warn: slow query')
} else {
  console.error(`fake docker: unsupported ${args.join(' ')}`)
  process.exit(2)
}
