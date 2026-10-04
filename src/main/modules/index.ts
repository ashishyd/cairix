import { homedir } from 'os'
import { IPC } from '@shared/ipc'
import type { PortSnapshot } from '@shared/types'
import { broadcast } from '../broadcast'
import { getSettings } from '../settings'
import { setTrayStatus } from '../tray'
import { join } from 'path'
import { app, shell } from 'electron'
import { claudeBin } from './changes/ai'
import { registerActionsHandlers } from './actions/handlers'
import { openInMacApp } from './actions/exec'
import { ActionStore } from './actions/store'
import { git } from './changes/git'
import { Broker } from './plugins/broker'
import { ElectronPluginHost } from './plugins/host'
import { registerPluginsHandlers } from './plugins/handlers'
import { PluginManager } from './plugins/manager'
import { registerTasksHandlers } from './tasks/handlers'
import { TasksService } from './tasks/service'
import { registerAuditHandlers } from './audit/handlers'
import { AuditService } from './audit/service'
import { registerChangesHandlers } from './changes/handlers'
import { ChangesService } from './changes/service'
import { detectCli } from './agents/service'
import { findProject, isInsideWorkspace, listWorkspaces } from './projects/store'
import { registerAgentsHandlers } from './agents/handlers'
import { AgentsService } from './agents/service'
import { registerAppHandlers } from './app/handlers'
import { runCommand } from './ports/exec'
import { registerPortsHandlers } from './ports/handlers'
import { PortsService } from './ports/service'
import { registerProjectsHandlers } from './projects/handlers'
import { resolveProjectForCwd } from './projects/store'
import { registerScriptsHandlers } from './scripts/handlers'
import { ScriptRunner } from './scripts/runner'

/**
 * Wires every feature module's services and IPC handlers. This is the single
 * place the modules meet, so adding one is: write the service, write its
 * handlers, register it here, list it in shared/modules.ts.
 */
export interface Modules {
  runner: ScriptRunner
  ports: PortsService
  /** Stop background work and child processes. Called when the app quits. */
  dispose(): void
}

export function registerModules(): Modules {
  let lastSnapshot: PortSnapshot | undefined

  const refreshTray = (): void => {
    const servers = new Set<number>()
    for (const e of lastSnapshot?.entries ?? []) {
      if ((e.category === 'dev' || e.category === 'database') && !e.protected) servers.add(e.footprintPid)
    }
    const running = runner.list().filter((r) => r.status === 'running' || r.status === 'stopping').length
    setTrayStatus({ dev: servers.size, runs: running }, getSettings().trayShowsPortCount)
  }

  const runner = new ScriptRunner({
    onRun: (info) => {
      broadcast(IPC.scriptsRunEvent, info)
      refreshTray()
    },
    onOutput: (e) => broadcast(IPC.scriptsOutput, e)
  })

  const ports = new PortsService({
    resolveProject: resolveProjectForCwd,
    activeRunPids: () => runner.activePids(),
    onRunPorts: (runId, p) => runner.setPorts(runId, p),
    onSnapshot: (snapshot) => {
      lastSnapshot = snapshot
      broadcast(IPC.portsChanged, snapshot)
      refreshTray()
    }
  })

  const agents = new AgentsService({
    run: runCommand,
    // CAIRIX_HOME lets tests point at a fake home folder instead of the real one.
    home: process.env.CAIRIX_HOME || homedir(),
    resolveProject: resolveProjectForCwd
  })

  const changes = new ChangesService({
    dataDir: app.getPath('userData'),
    allProjects: () =>
      listWorkspaces().flatMap((w) => w.projects.map((p) => ({ id: p.id, name: p.relPath || w.name, path: p.path, hasGit: p.hasGit, trusted: w.trusted }))),
    detectClaude: () => detectCli(claudeBin()),
    project: (id) => {
      const f = findProject(id)
      return f ? { path: f.project.path, trusted: f.workspace.trusted } : undefined
    }
  })

  const audit = new AuditService({
    dataDir: app.getPath('userData'),
    detectClaude: () => detectCli(claudeBin()),
    isDismissed: (p, f) => changes.isDismissed(p, f),
    project: (id) => {
      const f = findProject(id)
      return f ? { path: f.project.path, trusted: f.workspace.trusted } : undefined
    }
  })

  const actions = new ActionStore(app.getPath('userData'), (list) => broadcast(IPC.actionsChanged, list))

  const userData = app.getPath('userData')
  const tasks = new TasksService({
    dataDir: userData,
    detect: (bin) => detectCli(bin),
    project: (id) => {
      const f = findProject(id)
      return f ? { path: f.project.path, trusted: f.workspace.trusted } : undefined
    },
    registerProposal: (projectId, sourceId, patch, cost) => changes.registerProposal(projectId, sourceId, patch, 'agent', cost)
  })
  const broker = new Broker({
    dataDir: userData,
    grantedFor: (id) => plugins.grantedFor(id),
    projects: () => listWorkspaces().flatMap((w) => w.projects.map((p) => ({ id: p.id, name: p.relPath || w.name, path: p.path, kinds: p.kinds }))),
    ports: () => (ports.snapshot()?.entries ?? []).filter((e) => !e.protected).map((e) => ({ port: e.port, name: e.name, framework: e.framework, project: e.projectName, memoryKb: e.treeRssKb, category: e.category })),
    agents: () => lastAgents.map((s) => ({ title: s.title, kind: s.kind, status: s.status, project: s.projectName })),
    notify: (pluginId, message, kind) => broadcast(IPC.pluginsNotify, { plugin: plugins.list().find((p) => p.manifest.id === pluginId)?.manifest.name ?? pluginId, message, kind }),
    openUrl: (url) => shell.openExternal(url)
  })
  const plugins = new PluginManager({
    pluginsDir: join(userData, 'plugins'),
    dataDir: userData,
    createHost: (m, code) => new ElectronPluginHost(m, code),
    onChange: () => broadcast(IPC.pluginsChanged, null),
    onUninstall: (id) => broker.purge(id)
  })
  let lastAgents: Awaited<ReturnType<AgentsService['snapshot']>>['sessions'] = []
  setInterval(() => void agents.snapshot().then((s) => (lastAgents = s.sessions), () => undefined), 5000).unref()

  registerAppHandlers()
  registerProjectsHandlers(runner)
  registerScriptsHandlers(runner)
  registerPortsHandlers(ports)
  registerAgentsHandlers(agents)
  registerChangesHandlers(changes)
  registerAuditHandlers(audit, changes)
  registerPluginsHandlers(plugins, broker)
  registerTasksHandlers(tasks)
  void plugins.startEnabled()
  registerActionsHandlers(actions, {
    runner,
    findProject,
    isInsideWorkspace,
    branchOf: (p) => git(p, ['rev-parse', '--abbrev-ref', 'HEAD']).then((s) => s.trim(), () => ''),
    openExternal: (url) => shell.openExternal(url),
    openInApp: openInMacApp
  })
  ports.start()

  return {
    runner,
    ports,
    dispose: () => {
      tasks.stopAll()
      plugins.stopAll()
      ports.stop()
      runner.stopAll()
    }
  }
}
