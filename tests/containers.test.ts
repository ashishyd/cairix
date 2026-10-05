import { describe, expect, it } from 'vitest'
import { CONTAINER_ID, parseContainers, parseLabels } from '../src/main/modules/containers/docker'
import { ContainersService, type ContainersDeps } from '../src/main/modules/containers/service'

const ps = (rows: Array<Record<string, string>>): string => rows.map((r) => JSON.stringify(r)).join('\n') + '\n'
const ROWS = [
  { ID: 'aaaaaaaaaaaa1111', Names: 'app-web-1', Image: 'node:20', State: 'running', Status: 'Up 3 hours', Ports: '0.0.0.0:3000->3000/tcp', Labels: 'com.docker.compose.project=app,com.docker.compose.service=web,com.docker.compose.project.working_dir=/work/app,x=y,z=a,b' },
  { ID: 'bbbbbbbbbbbb2222', Names: 'app-db-1', Image: 'postgres:16', State: 'exited', Status: 'Exited (0) 1 hour ago', Ports: '', Labels: 'com.docker.compose.project=app,com.docker.compose.service=db,com.docker.compose.project.working_dir=/work/app' },
  { ID: 'cccccccccccc3333', Names: 'redis', Image: 'redis', State: 'running', Status: 'Up 5 days', Ports: '6379/tcp', Labels: '' }
]

describe('parsing docker output', () => {
  it('splits labels without breaking values that contain commas', () => {
    expect(parseLabels('a=1,b=two,three,c=3')).toEqual({ a: '1', b: 'two,three', c: '3' })
    expect(parseLabels('')).toEqual({})
  })
  it('parses containers and their Compose metadata, skipping noise lines', () => {
    const list = parseContainers('WARNING: something\n' + ps(ROWS) + '{broken json\n')
    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({ id: 'aaaaaaaaaaaa1111', name: 'app-web-1', state: 'running', composeProject: 'app', composeService: 'web', workingDir: '/work/app' })
    expect(list[2]).toMatchObject({ composeProject: undefined, workingDir: undefined })
  })
  it('only accepts hexadecimal container ids', () => {
    expect(CONTAINER_ID.test('aaaaaaaaaaaa')).toBe(true)
    for (const bad of ['', 'abc', 'xyz123456789', 'aaaaaaaaaaaa; rm -rf ~', '--all', 'A'.repeat(12)]) expect(CONTAINER_ID.test(bad), bad).toBe(false)
  })
})

function fake(over: { stdout?: string; fail?: Error } = {}) {
  const calls: string[][] = []
  const deps: ContainersDeps = {
    projectForFolder: (p) => (p === '/work/app' ? { id: 'p1', name: 'web-app' } : undefined),
    run: async (args) => {
      calls.push(args)
      if (over.fail) throw over.fail
      if (args[0] === 'ps') return { stdout: over.stdout ?? ps(ROWS), stderr: '' }
      if (args[0] === 'logs') return { stdout: 'line one\nTOKEN ghp_abcdefghijklmnopqrstuvwxyz0123456789\n', stderr: 'an error\n' }
      return { stdout: '', stderr: '' }
    }
  }
  return { svc: new ContainersService(deps), calls }
}

describe('the containers service', () => {
  it('lists running containers first, shortens ids, and links Compose folders to projects', async () => {
    const s = await fake().svc.list()
    expect(s.available).toBe(true)
    expect(s.containers.map((c) => c.name)).toEqual(['app-web-1', 'redis', 'app-db-1'])
    expect(s.containers[0]).toMatchObject({ id: 'aaaaaaaaaaaa', projectId: 'p1', projectName: 'web-app' })
    expect(s.containers[1].projectId).toBeUndefined()
  })
  it('says why Docker is unavailable', async () => {
    expect(await fake({ fail: Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }) }).svc.list()).toMatchObject({ available: false, reason: 'Docker is not installed.' })
    expect((await fake({ fail: new Error('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?') }).svc.list()).reason).toMatch(/not running/)
    expect((await fake({ fail: new Error('weird') }).svc.list()).reason).toBe('weird')
  })
  it('runs start, stop and restart only on a container that exists now', async () => {
    const f = fake()
    await f.svc.action('aaaaaaaaaaaa', 'restart')
    await f.svc.action('bbbbbbbbbbbb', 'start')
    expect(f.calls.filter((c) => c[0] !== 'ps')).toEqual([['restart', 'aaaaaaaaaaaa'], ['start', 'bbbbbbbbbbbb']])
    await expect(f.svc.action('dddddddddddd', 'stop')).rejects.toThrow(/no longer exists/)
    await expect(f.svc.action('--all', 'stop')).rejects.toThrow(/not a container id/)
    await expect(f.svc.action('aaaaaaaaaaaa; rm -rf ~', 'stop')).rejects.toThrow(/not a container id/)
    expect(f.calls.some((c) => c[0] === 'stop')).toBe(false)
  })
  it('reads logs from both streams, bounds the tail, and masks tokens', async () => {
    const f = fake()
    const text = await f.svc.logs('aaaaaaaaaaaa', 99_999)
    expect(text).toContain('line one')
    expect(text).toContain('an error')
    expect(text).not.toContain('ghp_abcdef')
    expect(f.calls.find((c) => c[0] === 'logs')).toEqual(['logs', '--tail', '2000', '--timestamps', 'aaaaaaaaaaaa'])
    await f.svc.logs('aaaaaaaaaaaa', 1)
    expect(f.calls.filter((c) => c[0] === 'logs').at(-1)).toContain('10')
  })
})
