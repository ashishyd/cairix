import { describe, expect, it } from 'vitest'
import {
  isExposed,
  parseDockerPorts,
  parseEtime,
  parseLsofCwd,
  parseLsofListeners,
  parsePs
} from '../src/main/modules/ports/parse'
import { classify, portHint, protection } from '../src/main/modules/ports/classify'

describe('parseLsofListeners', () => {
  const sample = [
    'p625',
    'crapportd',
    'Lashish',
    'f11',
    'n*:49152',
    'f12',
    'n*:49152',
    'p666',
    'cControlCenter',
    'Lashish',
    'f9',
    'n*:7000',
    'f11',
    'n*:5000',
    'p3386',
    'cfigma_agent',
    'Lashish',
    'f9',
    'n127.0.0.1:44950',
    'f14',
    'n[::1]:44950',
    'p500',
    'cCode\\x20Helper\\x20(Plugin)',
    'Lashish',
    'f3',
    'n127.0.0.1:60470'
  ].join('\n')

  it('parses pid, name, user, port and address', () => {
    const l = parseLsofListeners(sample)
    expect(l.find((x) => x.port === 7000)).toEqual({
      pid: 666,
      name: 'ControlCenter',
      user: 'ashish',
      port: 7000,
      address: '*'
    })
  })

  it('merges IPv4 and IPv6 sockets of the same port into one entry', () => {
    const l = parseLsofListeners(sample)
    expect(l.filter((x) => x.pid === 625)).toHaveLength(1)
    expect(l.filter((x) => x.port === 44950)).toHaveLength(1)
  })

  it('decodes lsof \\xNN escapes in command names', () => {
    expect(parseLsofListeners(sample).find((x) => x.pid === 500)!.name).toBe('Code Helper (Plugin)')
  })

  it('keeps one entry per (pid, port) and finds every port a process listens on', () => {
    const l = parseLsofListeners(sample)
    expect(l.filter((x) => x.pid === 666).map((x) => x.port)).toEqual([7000, 5000])
  })

  it('prefers the widest bind address when merging', () => {
    const l = parseLsofListeners('p1\ncnode\nLme\nf1\nn127.0.0.1:3000\nf2\nn*:3000\n')
    expect(l).toHaveLength(1)
    expect(l[0].address).toBe('*')
    expect(isExposed(l[0].address)).toBe(true)
  })

  it('ignores established connections, bad ports and empty input', () => {
    expect(parseLsofListeners('')).toEqual([])
    expect(parseLsofListeners('p1\ncx\nLu\nf1\nn127.0.0.1:5000->127.0.0.1:6000\n')).toEqual([])
    expect(parseLsofListeners('p1\ncx\nLu\nf1\nn*:0\nf2\nn*:99999\nf3\nnnonsense\n')).toEqual([])
  })

  it('classifies loopback binds as not exposed', () => {
    expect(isExposed('127.0.0.1')).toBe(false)
    expect(isExposed('[::1]')).toBe(false)
    expect(isExposed('*')).toBe(true)
    expect(isExposed('192.168.1.5')).toBe(true)
  })
})

describe('parseLsofCwd', () => {
  it('maps pid to cwd', () => {
    const m = parseLsofCwd('p100\nfcwd\nn/Users/x/app\np200\nfcwd\nn/\n')
    expect(m.get(100)).toBe('/Users/x/app')
    expect(m.get(200)).toBe('/')
  })
})

describe('ps parsing', () => {
  it.each([
    ['05:09', 309],
    ['02:14:09', 8049],
    ['1-00:26:06', 87966],
    ['23-04:00:01', 23 * 86400 + 4 * 3600 + 1], // 2_001_601
    ['garbage', 0]
  ])('etime %s -> %i s', (input, secs) => {
    expect(parseEtime(input)).toBe(secs)
  })

  it('parses columns and keeps the full command line with spaces', () => {
    const out = [
      '    1     0     1   9000  0.1 23-04:00:01 /sbin/launchd',
      '  646     1   646 156384  2.5       01:13:52 /Applications/Visual Studio Code.app/Contents/MacOS/Code --flag=a b',
      'not a process line'
    ].join('\n')
    const procs = parsePs(out)
    expect(procs).toHaveLength(2)
    expect(procs[1]).toMatchObject({
      pid: 646,
      ppid: 1,
      pgid: 646,
      rssKb: 156384,
      cpu: 2.5,
      uptimeSec: 4432,
      command: '/Applications/Visual Studio Code.app/Contents/MacOS/Code --flag=a b'
    })
  })
})

describe('parseDockerPorts', () => {
  it('maps published host ports to container names', () => {
    const out = [
      'pg\t0.0.0.0:5432->5432/tcp, :::5432->5432/tcp',
      'web\t0.0.0.0:8080-8082->80-82/tcp',
      'internal\t9000/tcp',
      ''
    ].join('\n')
    const m = parseDockerPorts(out)
    expect(m.get(5432)).toBe('pg')
    expect([8080, 8081, 8082].map((p) => m.get(p))).toEqual(['web', 'web', 'web'])
    expect(m.has(9000)).toBe(false)
  })
})

describe('classify', () => {
  it.each([
    ['next-server (v15.0.0)', 'Next.js', 'dev'],
    ['node /x/node_modules/.bin/../vite/bin/vite.js --port 5173', 'Vite', 'dev'],
    ['/opt/homebrew/bin/python3 -m http.server 8765', 'Python http.server', 'dev'],
    ['/opt/homebrew/opt/postgresql@16/bin/postgres -D /data', 'PostgreSQL', 'database'],
    ['redis-server *:6379', 'Redis', 'database'],
    ['node server.js', 'Node.js', 'dev'],
    ['/usr/bin/python3 manage.py runserver', 'Django', 'dev'],
    ['uvicorn app.main:app --reload', 'Uvicorn', 'dev']
  ])('%s -> %s (%s)', (cmd, framework, category) => {
    expect(classify(cmd)).toEqual({ framework, category })
  })

  it('leaves unrelated apps uncategorised', () => {
    expect(classify('/Applications/Figma.app/Contents/MacOS/figma_agent')).toEqual({ category: 'other' })
    // VS Code's extension host has "--node-ipc" but is not a Node dev server
    expect(classify('/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin) --node-ipc').category).toBe('other')
  })
})

describe('protection and hints', () => {
  const base = { selfPids: new Set([100]), currentUser: 'me', user: 'me' }
  it('protects launchd, Cairix, other users and macOS services', () => {
    expect(protection({ ...base, pid: 1, command: '/sbin/launchd' }).protected).toBe(true)
    expect(protection({ ...base, pid: 100, command: 'Cairix' }).reason).toMatch(/Cairix itself/)
    expect(protection({ ...base, pid: 5, command: 'node', user: 'root' }).reason).toMatch(/root/)
    expect(protection({ ...base, pid: 666, command: '/System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter' }).protected).toBe(true)
    expect(protection({ ...base, pid: 700, command: '/Applications/Docker.app/Contents/MacOS/com.docker.backend' }).reason).toMatch(/Docker/)
  })

  it("does not protect Apple's /usr/bin/python3 running a dev server", () => {
    expect(protection({ ...base, pid: 900, command: '/usr/bin/python3 -m http.server 8000' }).protected).toBe(false)
  })

  it('explains the macOS AirPlay Receiver squatting on 5000 and 7000', () => {
    expect(portHint(7000, '/System/Library/CoreServices/ControlCenter.app/.../ControlCenter')).toMatch(/AirPlay/)
    expect(portHint(3000, 'node')).toBeUndefined()
  })
})
