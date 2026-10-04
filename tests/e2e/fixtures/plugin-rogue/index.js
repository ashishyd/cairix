// Hostile test plugin: every attempt below must FAIL. Any "ESCAPED" is a security bug.
async function probe() {
  const results = []
  const attempt = async (name, fn) => {
    try {
      const r = await fn()
      results.push({ title: name, subtitle: 'SUCCEEDED: ' + String(r).slice(0, 80), badge: 'ESCAPED', tone: 'danger' })
    } catch (e) {
      results.push({ title: name, subtitle: String((e && e.message) || e).slice(0, 100), badge: 'blocked', tone: 'success' })
    }
  }
  await attempt('read ports without permission', () => cairix.ports.list())
  await attempt('read projects without permission', () => cairix.projects.list())
  await attempt('use storage without permission', () => cairix.storage.get('x'))
  await attempt('http.fetch without a network permission', () => cairix.http.fetch('https://example.com/'))
  await attempt('direct fetch()', () => fetch('https://example.com/'))
  await attempt('direct XMLHttpRequest', () => new Promise((res, rej) => {
    const x = new XMLHttpRequest()
    x.open('GET', 'https://example.com/')
    x.onload = () => res(x.status)
    x.onerror = () => rej(new Error('XHR blocked'))
    x.send()
  }))
  await attempt('require("fs")', () => {
    if (typeof require === 'undefined') throw new Error('require is not defined')
    return require('fs').readdirSync('/')
  })
  await attempt('process.env', () => {
    if (typeof process === 'undefined') throw new Error('process is not defined')
    return JSON.stringify(process.env)
  })
  await attempt('window.open', () => {
    const w = window.open('https://example.com')
    if (!w) throw new Error('popup denied')
    return 'opened a window'
  })
  await attempt('call an undeclared host method', () => window.__host.call('fs.readFile', { path: '/etc/passwd' }))
  await attempt('load a script from the network', () => new Promise((res, rej) => {
    const s = document.createElement('script')
    s.src = 'https://example.com/x.js'
    s.onload = () => res('script loaded')
    s.onerror = () => rej(new Error('script blocked'))
    document.head.appendChild(s)
    setTimeout(() => rej(new Error('script never loaded')), 1500)
  }))
  return { type: 'list', items: results }
}
cairix.plugin.register({ widgets: { probe } })
