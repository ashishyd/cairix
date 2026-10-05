import { homedir } from 'os'
import { IPC } from '@shared/ipc'
import { isModuleEnabled, MODULES } from '@shared/modules'
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
import { parseArgs } from '@shared/args'
import { findProject, isInsideWorkspace, listWorkspaces } from './projects/store'
import { registerAgentsHandlers } from './agents/handlers'
import { AgentsService } from './agents/service'
import { createNotifier } from './notify/electron'
import { registerNotifyHandlers } from './notify/handlers'
import { registerRunsHandlers } from './runs/handlers'
import { RunHistoryStore } from './runs/store'
import { registerAppHandlers } from './app/handlers'
import { runCommand } from './ports/exec'
import { registerGitHandlers } from './git/handlers'
import { GitService } from './git/service'
import { registerHealthHandlers } from './health/handlers'
import { HealthService } from './health/service'
import { registerContainersHandlers } from './containers/handlers'
import { ContainersService } from './containers/service'
import { registerSchedulesHandlers } from './schedules/handlers'
import { Scheduler } from './schedules/service'
import { ScheduleStore } from './schedules/store'
import { registerLearnHandlers } from './learn/handlers'
import { LearnService } from './learn/service'
import { LearnStore } from './learn/store'
import { registerEnvHandlers } from './env/handlers'
import { EnvService } from './env/service'
import { registerHistoryHandlers } from './history/handlers'
import { HistoryService } from './history/service'
import { registerProcessesHandlers } from './processes/handlers'
import { ProcessesService } from './processes/service'
import { registerPortsHandlers } from './ports/handlers'
import { PortsService } from './ports/service'
import { registerProjectsHandlers } from './projects/handlers'
import { resolveProjectForCwd } from './projects/store'
import { registerScriptsHandlers, scriptExists, startScriptById } from './scripts/handlers'
import { ScriptConfigStore } from './scripts/config'
import { Supervisor } from './scripts/supervisor'
import { RunWatcher, watchFolder } from './scripts/watcher'
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

  const notifier = createNotifier()
  const runHistory = new RunHistoryStore(app.getPath('userData'), (records) => broadcast(IPC.runsChanged, records))

  const configs = new ScriptConfigStore(app.getPath('userData'), (all) => broadcast(IPC.scriptsConfigsChanged, all))

  const supervisor = new Supervisor({
    enabled: (scriptId) => getSettings().autoRestartScripts.includes(scriptId),
    restart: async (info, attempt) => {
      await startScriptById(runner, info.scriptId, info.args ?? [], attempt, configs.get(info.scriptId)?.env)
    },
    onGiveUp: (info, attempts) => notifier.crashLoop(info, attempts),
    // Test hook, like CAIRIX_HOME: CAIRIX_RESTART_BACKOFF_MS="50,50" shortens the waits.
    backoff: process.env.CAIRIX_RESTART_BACKOFF_MS?.split(',').map(Number).filter((n) => n >= 0)
  })

  const watcher = new RunWatcher({
    folderOf: (info) => findProject(info.projectId)?.project.path,
    enabled: (scriptId) => !!configs.get(scriptId)?.watch,
    watch: watchFolder,
    restart: async (info) => {
      // Stop the old process group first: the new one often wants the same port.
      runner.stop(info.runId)
      for (let i = 0; i < 80; i++) {
        const cur = runner.get(info.runId)
        if (!cur || cur.endedAt) break
        await new Promise((r) => setTimeout(r, 100))
      }
      await startScriptById(runner, info.scriptId, info.args ?? [], 0, configs.get(info.scriptId)?.env)
    },
    onLoop: (info) => notifier.watchLoop(info)
  })

  const runner = new ScriptRunner({
    onRun: (info) => {
      broadcast(IPC.scriptsRunEvent, info)
      refreshTray()
      // First time we see a run in a final state: keep it, and tell the user if it matters.
      if (info.endedAt) {
        if (runHistory.record(info, runner.log(info.runId).text)) {
          // A crash that is being retried is not news; only report it when nobody is handling it.
          if (supervisor.onRunEnded(info) === 'ignored') notifier.run(info)
        }
        watcher.onRunEnded(info)
      } else if (info.status === 'running') {
        supervisor.onRunStarted(info.scriptId)
        watcher.onRunStarted(info)
      }
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

  const processes = new ProcessesService({
    ports: () => ports.snapshot()?.entries ?? [],
    activeRunPids: () => runner.activePids(),
    onSnapshot: (snapshot) => broadcast(IPC.processesChanged, snapshot)
  })

  const history = new HistoryService({
    dataDir: app.getPath('userData'),
    // A test or CI home folder can be injected the same way as for Agents.
    home: process.env.CAIRIX_HOME || homedir(),
    // A fake home must not be undone by the real shell's HISTFILE / ZDOTDIR.
    env: process.env.CAIRIX_HOME ? {} : process.env,
    isEnabled: () => {
      const m = MODULES.find((x) => x.id === 'history')
      return !!m && isModuleEnabled(m, getSettings().enabledModules)
    },
    onChange: (snapshot) => broadcast(IPC.historyChanged, snapshot)
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
    onFinish: (state) => notifier.audit(state),
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
    onFinish: (task) => notifier.task(task),
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

  registerGitHandlers(
    new GitService({
      project: (id) => {
        const f = findProject(id)
        return f ? { path: f.project.path, trusted: f.workspace.trusted, name: f.workspace.name, hasGit: f.project.hasGit } : undefined
      }
    })
  )
  registerHealthHandlers(
    new HealthService({
      git: (cwd, args) => git(cwd, args),
      isRunning: (projectId) => runner.list().some((r) => r.projectId === projectId && (r.status === 'running' || r.status === 'stopping')),
      minKb: process.env.CAIRIX_HOG_MIN_KB ? Number(process.env.CAIRIX_HOG_MIN_KB) : undefined,
      project: (id) => {
        const f = findProject(id)
        return f ? { path: f.project.path, trusted: f.workspace.trusted, name: f.workspace.name, hasGit: f.project.hasGit } : undefined
      }
    })
  )
  registerContainersHandlers(new ContainersService({ projectForFolder: (path) => resolveProjectForCwd(path) }))
  const scheduleStore = new ScheduleStore(app.getPath('userData'), () => broadcast(IPC.schedulesChanged, scheduler.list()))
  const scheduler = new Scheduler(scheduleStore, {
    tickMs: process.env.CAIRIX_SCHEDULER_TICK_MS ? Number(process.env.CAIRIX_SCHEDULER_TICK_MS) : undefined,
    isScriptActive: (scriptId) => runner.list().some((r) => r.scriptId === scriptId && (r.status === 'running' || r.status === 'stopping')),
    startScript: async (scriptId) => {
      const cfg = configs.get(scriptId)
      await startScriptById(runner, scriptId, parseArgs(cfg?.args ?? ''), 0, cfg?.env)
    },
    startTask: async (t) => {
      await tasks.start(t.projectId, { agent: t.agent, mode: 'read', prompt: t.prompt, budgetUsd: 0.5 })
    },
    headOf: async (projectId) => {
      const f = findProject(projectId)
      return f?.project.hasGit ? git(f.project.path, ['rev-parse', 'HEAD']).then((s) => s.trim(), () => undefined) : undefined
    }
  })
  registerSchedulesHandlers(scheduleStore, scheduler, {
    validateTarget: async (d) => {
      if (d.target.kind === 'script' && !(await scriptExists(d.target.scriptId))) throw new Error('That script no longer exists.')
      if (d.target.kind === 'task' && !findProject(d.target.projectId)) throw new Error('That project is no longer in Cairix.')
      if (d.trigger.kind === 'git-change' && !findProject(d.trigger.projectId)?.project.hasGit) throw new Error('That project is not a git repository.')
    }
  })
  scheduler.start()
  registerLearnHandlers(
    new LearnService({
      store: new LearnStore(app.getPath('userData')),
      detectClaude: () => detectCli(claudeBin()),
      onChange: (snapshot) => broadcast(IPC.learnChanged, snapshot)
    })
  )
  registerEnvHandlers(
    new EnvService({
      git,
      project: (id) => {
        const f = findProject(id)
        return f ? { path: f.project.path, trusted: f.workspace.trusted, name: f.workspace.name, hasGit: f.project.hasGit } : undefined
      }
    })
  )

  registerAppHandlers()
  registerNotifyHandlers(notifier)
  registerRunsHandlers(runHistory)
  registerProjectsHandlers(runner)
  registerScriptsHandlers(runner, configs, { listeners: async () => (await ports.scanFresh()).snapshot.entries })
  registerPortsHandlers(ports)
  registerAgentsHandlers(agents)
  registerProcessesHandlers(processes)
  registerHistoryHandlers(history, {
    runner,
    findProject,
    projectForFolder: (path) => {
      const hit = resolveProjectForCwd(path)
      return hit ? findProject(hit.id) : undefined
    }
  })
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
  history.start()

  return {
    runner,
    ports,
    dispose: () => {
      supervisor.dispose()
      scheduler.stop()
      watcher.dispose()
      tasks.stopAll()
      plugins.stopAll()
      history.stop()
      processes.stop()
      ports.stop()
      runner.stopAll()
    }
  }
}
