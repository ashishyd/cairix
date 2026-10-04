// A complete Cairix plugin. This file runs inside an isolated sandbox: it has
// no Node, no files and no network. Everything it can do is the `cairix` object.

const CLICKS = 'clicks'

// A widget returns a description of what to show. Cairix draws it.
async function counter() {
  const [projects, ports, clicks] = await Promise.all([
    cairix.projects.list(), // needs "projects.read"
    cairix.ports.list(), // needs "ports.read"
    cairix.storage.get(CLICKS) // needs "storage"
  ])
  return {
    type: 'stack',
    children: [
      {
        type: 'stack',
        direction: 'row',
        children: [
          { type: 'metric', label: 'Projects', value: String(projects.length) },
          { type: 'metric', label: 'Dev servers', value: String(ports.filter((p) => p.category === 'dev').length) },
          { type: 'metric', label: 'Clicks', value: String(clicks || 0) }
        ]
      },
      // Buttons name an action; Cairix calls it, then asks the widget to draw again.
      { type: 'button', label: 'Add one', action: 'bump', variant: 'primary' }
    ]
  }
}

// A tab appears on every project. It is told which project it is showing.
async function projectsTab({ projectId }) {
  const projects = await cairix.projects.list()
  const me = projects.find((p) => p.id === projectId)
  return {
    type: 'stack',
    children: [
      { type: 'heading', text: me ? me.name : 'Project' },
      { type: 'text', text: me ? me.path : '', muted: true },
      {
        type: 'list',
        items: projects.map((p) => ({ title: p.name, subtitle: p.kinds.join(', '), badge: p.id === projectId ? 'this one' : undefined, tone: 'accent' }))
      }
    ]
  }
}

cairix.plugin.register({
  widgets: { counter },
  tabs: { projects: projectsTab },
  commands: {
    say: async () => {
      await cairix.ui.notify('Hello from the example plugin!', 'success') // needs "notify"
    }
  },
  actions: {
    bump: async () => {
      const n = (await cairix.storage.get(CLICKS)) || 0
      await cairix.storage.set(CLICKS, n + 1)
    }
  }
})
