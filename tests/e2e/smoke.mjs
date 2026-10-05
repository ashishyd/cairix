/**
 * End-to-end smoke test: launches the BUILT app and drives it like a user.
 *
 *   pnpm build && pnpm e2e            # screenshots land in tests/e2e/shots
 *
 * Uses a throwaway userData dir (CAIRIX_USER_DATA) and a throwaway project
 * folder, so it never touches your real Cairix settings or projects.
 * The native folder dialog can't be clicked by automation, so it is stubbed
 * from the Electron side; everything else goes through the real UI and IPC.
 */
import { _electron as electron } from 'playwright-core'
import { createRequire } from 'module'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync } from 'fs'
import { execFileSync, spawn } from 'child_process'
import { createConnection, createServer } from 'net'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const shots = process.env.CAIRIX_E2E_SHOTS ?? join(root, 'tests/e2e/shots')
mkdirSync(shots, { recursive: true })
const electronPath = createRequire(import.meta.url)('electron')

// CAIRIX_E2E_APP=/path/to/Cairix.app/Contents/MacOS/Cairix runs the same scenario against a packaged build.
const packaged = process.env.CAIRIX_E2E_APP
if (!packaged && !existsSync(join(root, 'out/main/index.js'))) {
  console.error('Build first: pnpm build')
  process.exit(2)
}

// ───────────────────────── fixtures ─────────────────────────

const freePort = () =>
  new Promise((res, rej) => {
    const s = createServer()
    s.once('error', rej)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => res(port))
    })
  })

const canConnect = (port) =>
  new Promise((res) => {
    const c = createConnection({ port, host: '127.0.0.1' })
    c.once('connect', () => (c.destroy(), res(true)))
    c.once('error', () => res(false))
  })

const PORT = await freePort()
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-fixture-')))
const userData = mkdtempSync(join(tmpdir(), 'cairix-userdata-'))
const write = (rel, text) => {
  const f = join(fixture, rel)
  mkdirSync(dirname(f), { recursive: true })
  writeFileSync(f, text)
}
write('web-app/package.json', JSON.stringify({ name: 'web-app', scripts: { devserver: `node server.js --port ${PORT}`, trace: "node -e \"console.log('boom at ' + require('path').resolve('server.js') + ':3:5'); console.log('find' + 'me-needle'); console.log('find' + 'me-needle again')\"", watchme: "node -e \"console.log('watch-started ' + (process.env.GREETING || 'none')); setInterval(() => {}, 1e6)\"", crash: 'node -e "process.exit(3)"', serve: 'node server.js', build: "node -e \"console.log('building…')\"", lint: 'node -e "process.exit(0)"' } }, null, 2))
write('web-app/.gitignore', '.env\nnode_modules\n')
write('web-app/.nvmrc', '99\n')
write('web-app/.env.example', 'PORT=\nAPI_KEY=\nDATABASE_URL=\nNEW_FLAG=\n')
write('web-app/.env', 'PORT=3000\nAPI_KEY=sk-test-supersecretvalue123\n# keep this comment\nDATABASE_URL=\n')
write('web-app/server.js', `require('http').createServer((q, r) => r.end('ok')).listen(${PORT}, '127.0.0.1', () => console.log('listening on ${PORT}'))\n`)
write('mono/package.json', JSON.stringify({ name: 'mono', workspaces: ['apps/*'] }))
write('mono/pnpm-workspace.yaml', 'packages:\n  - apps/*\n')
write('mono/apps/site/package.json', JSON.stringify({ name: 'site', scripts: { dev: 'node -e "setInterval(()=>{},1000)"' } }))
write('mono/apps/docs/package.json', JSON.stringify({ name: 'docs', scripts: { build: 'node -e "1"' } }))
write('tools/requirements.txt', 'requests\n')
write('tools/hello.py', 'if __name__ == "__main__":\n    print("hello from python")\n')

// web-app is a git repo with one commit, plus an uncommitted file containing leftover debug code.
const gitIn = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: join(fixture, 'web-app') })
gitIn('init', '-q', '-b', 'main'); gitIn('add', '-A'); gitIn('commit', '-q', '-m', 'init')
mkdirSync(join(fixture, 'web-app/node_modules/big'), { recursive: true }) // git-ignored: a folder worth cleaning
writeFileSync(join(fixture, 'web-app/node_modules/big/data.bin'), 'x'.repeat(20_000))
const DIRTY = 'const user = load()\ndebugger\nmodule.exports = user\n'
write('web-app/dirty.js', DIRTY)

// A fake HOME so the Agents page is tested without touching the real ~/.claude or ~/.cursor.
// The "agent" is a real throwaway process, because sessions are only shown for live pids.
const fakeHome = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-home-')))
const agentProc = spawn('sleep', ['600'], { stdio: 'ignore' })
const agentStart = execFileSync('ps', ['-o', 'lstart=', '-p', String(agentProc.pid)]).toString().trim()
const session = (over = {}) =>
  JSON.stringify({
    pid: agentProc.pid, sessionId: 'e2e-session', cwd: join(fixture, 'web-app'), startedAt: Date.now() - 120_000,
    procStart: agentStart, version: '9.9.9', kind: 'interactive', entrypoint: 'cli', name: 'E2E: fix the login bug',
    status: 'busy', updatedAt: Date.now(), messagingSocketPath: '/tmp/LEAKED.sock', ...over
  })
mkdirSync(join(fakeHome, '.claude/sessions'), { recursive: true })
writeFileSync(join(fakeHome, `.claude/sessions/${agentProc.pid}.json`), session())
// A secret-bearing key file next to it. It is valid JSON on purpose: it must be ignored by name, not by luck.
writeFileSync(join(fakeHome, `.claude/sessions/${agentProc.pid}.ab12cd34.key`), session({ sessionId: 'LEAKED-KEY-FILE', name: 'LEAKED' }))
// A session whose process is gone must not be listed.
writeFileSync(join(fakeHome, '.claude/sessions/99999.json'), session({ pid: 99999, sessionId: 'stale', name: 'STALE-SESSION' }))
mkdirSync(join(fakeHome, '.cursor/plans'), { recursive: true })
writeFileSync(join(fakeHome, '.cursor/plans/demo_12345678.plan.md'), '---\nname: E2E plan title\n---\nbody')

// Shell history for the Commands page. The secret line must never be stored.
writeFileSync(
  join(fakeHome, '.zsh_history'),
  [
    ': 1700000000:0;git status',
    ': 1700000001:0;git status',
    ': 1700000002:0;git status',
    ': 1700000003:0;echo cairix-rerun-ok',
    ': 1700000004:0;echo cairix-rerun-ok',
    ': 1700000005:0;ls -la',
    ': 1700000007:0;false',
    ': 1700000006:0;curl -H "x" --api-key sk-abcdefghijklmnopqrstuvwxyz https://example.com',
    ''
  ].join('\n')
)
// A background process for the Processes page to list and stop.
const bgProc = spawn('sleep', ['601'], { stdio: 'ignore' })

// Stand-ins for Docker, the GitHub CLI, an editor and npm, so nothing real is touched or fetched.
const dockerState = join(tmpdir(), `cairix-docker-${process.pid}.json`)
const editorLog = join(tmpdir(), `cairix-editor-${process.pid}.log`)
writeFileSync(editorLog, '')
const label = (project, service) => `com.docker.compose.project=${project},com.docker.compose.service=${service},com.docker.compose.project.working_dir=${join(fixture, 'web-app')}`
writeFileSync(dockerState, JSON.stringify([
  { ID: 'aaaaaaaaaaaa', Names: 'app-web-1', Image: 'node:20', State: 'running', Status: 'Up 3 hours', Ports: '0.0.0.0:3000->3000/tcp', Labels: label('app', 'web') },
  { ID: 'bbbbbbbbbbbb', Names: 'app-db-1', Image: 'postgres:16', State: 'exited', Status: 'Exited (0) 1 hour ago', Ports: '', Labels: label('app', 'db') },
  { ID: 'cccccccccccc', Names: 'standalone-redis', Image: 'redis:7', State: 'running', Status: 'Up 5 days', Ports: '6379/tcp', Labels: '' }
]))

// ───────────────────────── harness ─────────────────────────

let failures = 0
const log = []
async function step(name, fn) {
  const t = Date.now()
  try {
    await fn()
    log.push(`  ✓ ${name} (${Date.now() - t} ms)`)
    console.log(log.at(-1))
  } catch (e) {
    failures++
    log.push(`  ✗ ${name}: ${e.message.replace(/\n/g, ' | ').slice(0, 700)}`)
    console.log(log.at(-1))
    try {
      await page?.screenshot({ path: join(shots, `FAIL-${failures}.png`) })
    } catch {
      /* page may be gone */
    }
  }
}
// Dialogs fade/pop in over ~160 ms; screenshots taken mid-animation look broken but aren't.
const settle = () => new Promise((r) => setTimeout(r, 300))
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

const env = {
  ...process.env,
  CAIRIX_DOCKER_BIN: join(root, 'tests/e2e/fake-docker.mjs'), CAIRIX_FAKE_DOCKER_STATE: dockerState,
  CAIRIX_GH_BIN: join(root, 'tests/e2e/fake-gh.mjs'),
  CAIRIX_EDITOR_BIN: join(root, 'tests/e2e/fake-editor.mjs'), CAIRIX_FAKE_EDITOR_LOG: editorLog,
  CAIRIX_FAKE_PM: join(root, 'tests/e2e/fake-pm.mjs'), CAIRIX_HOG_MIN_KB: '1', CAIRIX_SCHEDULER_TICK_MS: '400',
  CAIRIX_RESTART_BACKOFF_MS: '50,50,50,50,50', CAIRIX_USER_DATA: userData, CAIRIX_HOME: fakeHome, CAIRIX_CLAUDE_BIN: join(root, 'tests/e2e/fake-claude.mjs')
}
delete env.ELECTRON_RUN_AS_NODE
delete env.ELECTRON_RENDERER_URL

console.log(`Launching Cairix (fixture ${fixture}, port ${PORT})…`)
const app = await electron.launch(packaged ? { executablePath: packaged, args: [], env } : { executablePath: electronPath, args: [root], env })
const page = await app.firstWindow()
const consoleErrors = []
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()))
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`))
await page.waitForLoadState('domcontentloaded')
// Playwright pins prefers-color-scheme to "light" by default, which would hide the app's real
// theme handling (nativeTheme in main). null = stop emulating and use what Electron reports.
await page.emulateMedia({ colorScheme: null })
await page.setViewportSize({ width: 1220, height: 800 }).catch(() => undefined)

// ───────────────────────── scenario ─────────────────────────

await step('empty state invites adding a folder', async () => {
  await page.getByText('Add your first folder').first().waitFor({ timeout: 10_000 })
  await settle(); await page.screenshot({ path: join(shots, '01-home-empty.png') })
})

await step('add folder: preview lists every project, monorepo children included', async () => {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, fixture)
  await page.getByRole('button', { name: 'Add folder…' }).first().click()
  const dlg = page.getByRole('dialog', { name: 'Add a folder' })
  await dlg.getByText(/\d+ found/).waitFor({ timeout: 10_000 })
  const text = await dlg.innerText()
  for (const name of ['web-app', 'mono', 'mono/apps/site', 'mono/apps/docs', 'tools']) {
    assert(text.includes(name), `preview is missing "${name}"`)
  }
  assert(/5 found/.test(text), `expected "5 found" in preview, got: ${text.match(/\d+ found/)?.[0]}`)
  assert(text.includes('monorepo'), 'monorepo chip missing')
  await settle(); await page.screenshot({ path: join(shots, '02-add-folder-preview.png') })
})

await step('trust the folder and add it', async () => {
  const dlg = page.getByRole('dialog', { name: 'Add a folder' })
  await dlg.getByText('Trust this folder').click()
  await dlg.getByRole('button', { name: /^Add 5 projects$/ }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached', timeout: 10_000 })
})

await step('sidebar shows the nested project tree', async () => {
  const side = page.getByRole('complementary', { name: 'Sidebar' })
  await side.getByText('web-app').first().waitFor({ timeout: 5000 })
  const text = await side.innerText()
  assert(text.includes('apps/site') && text.includes('apps/docs'), `monorepo children not nested under mono: ${text}`)
  await settle(); await page.screenshot({ path: join(shots, '03-sidebar-tree.png') })
})

await step('scripts panel lists package.json scripts', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('web-app').first().click()
  await page.getByText('serve', { exact: true }).first().waitFor({ timeout: 5000 })
  const body = await page.locator('main').innerText()
  assert(body.includes('build') && body.includes('lint'), 'build/lint scripts missing')
  assert(body.includes('Trusted'), 'folder should show as Trusted')
  await settle(); await page.screenshot({ path: join(shots, '04-scripts.png') })
})

await step('Run starts the dev server and its port appears on the row', async () => {
  const row = page.locator('div.group', { has: page.locator('span.font-mono', { hasText: /^serve$/ }) }).first()
  await row.getByRole('button', { name: /^Run$/ }).click()
  await row.getByText(`:${PORT}`).waitFor({ timeout: 15_000 })
  assert(await canConnect(PORT), `server is not actually listening on ${PORT}`)
  await settle(); await page.screenshot({ path: join(shots, '05-script-running.png') })
})

await step('the log opens on Run and shows the server output, readable', async () => {
  // Run opens the log automatically; the row's button now says "Hide log".
  const log = page.getByRole('log', { name: 'Script output' })
  await log.waitFor({ timeout: 5000 })
  await page.waitForFunction((p) => document.querySelector('.xterm-rows')?.textContent?.includes(`listening on ${p}`), PORT, { timeout: 10_000 })
  // Regression: xterm ignored our modern rgb() syntax and drew white text on a light panel.
  const [r, g, b] = await page.evaluate(() => {
    const m = getComputedStyle(document.querySelector('.xterm-rows')).color.match(/[\d.]+/g)
    return m.slice(0, 3).map(Number)
  })
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  assert(luminance < 0.45, `log text is too light on a light theme: rgb(${r}, ${g}, ${b})`)
  await settle(); await page.screenshot({ path: join(shots, '06-log.png') })
})

await step('Ports page shows the server with memory and the Cairix badge', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Ports/ }).click()
  await page.getByText(String(PORT), { exact: true }).first().waitFor({ timeout: 10_000 })
  const row = page.locator('div.group', { has: page.getByText(String(PORT), { exact: true }) }).first()
  const text = await row.innerText()
  assert(/\d+ (KB|MB|GB)/.test(text), `memory missing in row: ${text}`)
  assert(text.includes('Cairix'), `"started from Cairix" badge missing: ${text}`)
  assert(text.includes('web-app'), `project name missing: ${text}`)
  await settle(); await page.screenshot({ path: join(shots, '07-ports.png') })
})

await step('system services are protected (no stop button)', async () => {
  await page.getByRole('radio', { name: 'All', exact: true }).click()
  await page.getByText('Port', { exact: true }).first().waitFor()
  const hasControlCenter = (await page.getByText('ControlCenter').count()) > 0
  const locks = await page.getByLabel(/Part of macOS|Docker infrastructure|itself/).count()
  // On a Mac running AirPlay Receiver, ControlCenter listens on 5000/7000 and must show a lock.
  assert(!hasControlCenter || locks > 0, 'macOS services should show a lock, not a stop button')
  assert(!hasControlCenter || (await page.getByRole('button', { name: /Stop ControlCenter/ }).count()) === 0, 'ControlCenter must not be stoppable')
  await settle(); await page.screenshot({ path: join(shots, '08-ports-all.png') })
  await page.getByRole('radio', { name: 'Dev servers' }).click()
})

await step('stopping from the Ports page frees the port', async () => {
  await page.getByRole('button', { name: new RegExp(`Stop .* on :${PORT}`) }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByText(String(PORT)).first().waitFor({ timeout: 5000 })
  await settle(); await page.screenshot({ path: join(shots, '09-kill-confirm.png') })
  await dlg.getByRole('button', { name: 'Stop', exact: true }).click()
  await page.getByText(/Port \d+ is free/).first().waitFor({ timeout: 10_000 })
  let closed = false
  for (let i = 0; i < 30 && !closed; i++) {
    closed = !(await canConnect(PORT))
    if (!closed) await new Promise((r) => setTimeout(r, 100))
  }
  assert(closed, `port ${PORT} is still accepting connections after Stop`)
})

await step('the script row reflects that it stopped', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('web-app').first().click()
  const row = page.locator('div.group', { has: page.locator('span.font-mono', { hasText: /^serve$/ }) }).first()
  await row.getByText('Stopped').waitFor({ timeout: 5000 })
  await row.getByRole('button', { name: /^Run$/ }).waitFor()
})

await step('Agents page lists a live Claude session, hides stale ones, and never reads key files', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Agents/ }).click()
  await page.getByText('E2E: fix the login bug').waitFor({ timeout: 10_000 })
  const main = await page.locator('main').innerText()
  assert(main.includes('Working'), 'busy session should read "Working"')
  assert(main.includes('web-app'), 'session should be linked to its project')
  assert(main.includes('E2E plan title'), 'recent Cursor plan missing')
  assert(!main.includes('STALE-SESSION'), 'a session whose process is gone must not be listed')
  assert(!/LEAKED/.test(await page.content()), 'content of a *.key file or socket path leaked into the page')
  await page.getByRole('complementary', { name: 'Sidebar' }).getByTitle('1 working').waitFor()
  await settle(); await page.screenshot({ path: join(shots, '13-agents.png') })
})

await step('Commands page ranks by how often you ran them, explains them, and never stores secrets', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Commands/ }).click()
  await page.getByText('git status', { exact: true }).first().waitFor({ timeout: 15_000 })
  const rows = await page.locator('main span.font-mono.font-medium').allInnerTexts()
  assert(rows[0] === 'git status', `most-run command should be first, got ${rows.join(' | ')}`)
  assert(rows[1] === 'echo cairix-rerun-ok', `second should be the next most run: ${rows.join(' | ')}`)
  const main = await page.locator('main').innerText()
  assert(main.includes('3×') && main.includes('2×'), 'run counts missing')
  assert(main.includes('Shows which files changed'), 'plain-English description missing')
  assert(!main.includes('sk-abcdefghij') && !main.includes('api-key'), 'a command with a secret was stored')
  await settle(); await page.screenshot({ path: join(shots, '14-commands.png') })
})

await step('Commands: filter narrows the list, sort can change', async () => {
  const box = page.getByRole('textbox', { name: 'Filter commands' })
  await box.fill('echo')
  await page.waitForFunction(() => document.querySelectorAll('main span.font-mono.font-medium').length === 1)
  await box.fill('which files changed') // matches the description too
  await page.getByText('git status', { exact: true }).first().waitFor()
  await box.fill('')
  await page.getByRole('radio', { name: 'A–Z' }).click()
  const rows = await page.locator('main span.font-mono.font-medium').allInnerTexts()
  assert(rows[0] === 'echo cairix-rerun-ok', `A–Z should start with echo: ${rows}`)
  await page.getByRole('radio', { name: 'Most run' }).click()
})

await step('Commands: one-click re-run shows the output', async () => {
  await page.getByRole('button', { name: 'Run echo cairix-rerun-ok again' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor({ timeout: 10_000 })
  await dialog.getByText('cairix-rerun-ok').last().waitFor({ timeout: 10_000 })
  await settle(); await page.screenshot({ path: join(shots, '15-command-rerun.png') })
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
})

await step('Commands: a risky command asks before re-running', async () => {
  const hist = join(fakeHome, '.zsh_history')
  writeFileSync(hist, readFileSync(hist, 'utf8') + ': 1700000100:0;rm -rf /tmp/cairix-e2e-never\n')
  const row = page.getByText('rm -rf /tmp/cairix-e2e-never', { exact: true })
  await row.waitFor({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Run rm -rf /tmp/cairix-e2e-never again' }).click()
  await page.getByRole('dialog', { name: 'Run this again?' }).waitFor()
  await page.getByRole('button', { name: 'Cancel' }).click()
})

await step('Commands: never-track removes a command, keeps it out, and can be undone', async () => {
  await page.getByRole('button', { name: 'Never track ls -la' }).click()
  await page.getByRole('button', { name: /Just this command/ }).click()
  await page.waitForFunction(() => !document.querySelector('main')?.textContent?.includes('ls -la'), undefined, { timeout: 5000 })
  const hist = join(fakeHome, '.zsh_history')
  writeFileSync(hist, readFileSync(hist, 'utf8') + ': 1700000200:0;ls -la\n: 1700000201:0;git status\n')
  // the new git status is counted (4×) while the ignored ls stays out
  await page.getByText('4×').first().waitFor({ timeout: 15_000 })
  assert(!(await page.locator('main').innerText()).includes('ls -la'), 'an ignored command came back')
  const saved = JSON.parse(readFileSync(join(userData, 'history.json'), 'utf8'))
  assert(saved.rules.some((r) => r.value === 'ls -la') && !saved.commands.some((c) => c.c === 'ls -la'), 'history.json should hold the rule and no ls -la')
  await page.getByRole('button', { name: /^Never tracked \(1\)/ }).click()
  await page.getByRole('button', { name: 'Track again' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
})

await step('Commands: an opt-in hook adds folder context, filters by project, and re-runs where it ran', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Commands/ }).click()
  await page.getByText('Know where each command ran').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Set up…' }).click()
  const dlg = page.getByRole('dialog', { name: /Record which folder/ })
  const shown = await dlg.innerText()
  assert(shown.includes('cairix command folders') && shown.includes('.zshrc.cairix-backup'), 'the dialog must show exactly what will be added')
  assert(!existsSync(join(fakeHome, '.zshrc')), 'nothing may be written before the user agrees')
  await dlg.getByRole('button', { name: 'Add to .zshrc' }).click()
  await page.locator('main').getByText('Folder tracking is on.').waitFor({ timeout: 10_000 })
  const rc = readFileSync(join(fakeHome, '.zshrc'), 'utf8')
  assert(rc.includes('# >>> cairix command folders >>>') && rc.includes('cairix-hook.zsh'), `.zshrc block missing: ${rc}`)
  assert(existsSync(join(userData, 'shell', 'cairix-hook.zsh')), 'hook script was not written')

  // Pretend a terminal tab ran `pwd` in two folders (the hook appends here; history gets the same commands).
  mkdirSync(join(userData, 'shell'), { recursive: true })
  writeFileSync(join(userData, 'shell', 'commands.log'), [`1700001000\t${join(fixture, 'web-app')}\tpwd`, `1700001001\t${join(fixture, 'web-app')}\tpwd`, `1700001002\t${join(fixture, 'tools')}\tpwd`, ''].join('\n'))
  writeFileSync(join(fakeHome, '.zsh_history'), readFileSync(join(fakeHome, '.zsh_history'), 'utf8') + ': 1700001000:0;pwd\n: 1700001001:0;pwd\n: 1700001002:0;pwd\n')
  await page.getByText('pwd', { exact: true }).first().waitFor({ timeout: 15_000 })
  await page.locator('main span.font-mono.font-medium', { hasText: /^pwd$/ }).first().waitFor()
  const row = page.locator('main div.grid', { has: page.locator('span.font-mono.font-medium', { hasText: /^pwd$/ }) }).first()
  await row.getByText(/web-app \+1/).waitFor({ timeout: 10_000 })

  // Filter by project: only commands seen in web-app remain.
  await page.getByLabel('Only commands run in').selectOption({ label: 'web-app' })
  await page.waitForFunction(() => document.querySelectorAll('main span.font-mono.font-medium').length === 1)
  await settle(); await page.screenshot({ path: join(shots, '19-commands-folders.png') })

  // Re-run goes where it was run most (web-app), not the home folder.
  await page.getByRole('button', { name: 'Run pwd again' }).click()
  const out = page.getByRole('dialog')
  await out.getByText(new RegExp(`${fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/web-app`)).last().waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()

  await page.getByLabel('Only commands run in').selectOption({ label: 'Anywhere' })
  await page.getByRole('button', { name: 'Turn off' }).click()
  await page.getByText('Know where each command ran').waitFor({ timeout: 10_000 })
  assert(!readFileSync(join(fakeHome, '.zshrc'), 'utf8').includes('cairix command folders'), 'turning it off must remove the block')
})

await step('Env tab: keys at a glance, values on request, drift from .env.example, safe edits', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('web-app').first().click()
  await page.getByRole('tab', { name: 'Env' }).click()
  const card = page.getByRole('region', { name: '.env', exact: true })
  await card.waitFor({ timeout: 10_000 })
  assert(!(await page.content()).includes('supersecretvalue'), 'a secret value reached the page before it was revealed')
  await card.getByText('git-ignored').waitFor()
  assert((await card.innerText()).includes('3000'), 'harmless values such as PORT may be previewed')
  await page.getByText(/Missing/).first().waitFor()
  assert((await page.locator('main').innerText()).includes('NEW_FLAG'), 'the key missing from .env should be named')
  await page.getByRole('button', { name: 'Add missing keys' }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('Add missing keys'))
  assert(readFileSync(join(fixture, 'web-app/.env'), 'utf8').includes('NEW_FLAG='), 'the missing key was not added')

  await card.getByRole('button', { name: 'Show API_KEY' }).click()
  await card.getByText('sk-test-supersecretvalue123').waitFor()
  await card.getByRole('button', { name: 'Hide API_KEY' }).click()
  assert(!(await page.content()).includes('supersecretvalue'), 'hiding a value must remove it from the page')

  await card.getByRole('button', { name: 'Edit PORT' }).click()
  await card.getByRole('textbox', { name: 'Value of PORT' }).fill('4000')
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  await card.getByText('4000').waitFor()
  await card.getByRole('textbox', { name: /New variable name/ }).fill('GREETING_MSG')
  await card.getByRole('textbox', { name: /New variable value/ }).fill('hello world')
  await card.getByRole('button', { name: 'Add', exact: true }).click()
  await card.locator('span.selectable', { hasText: /^GREETING_MSG$/ }).waitFor()
  await card.getByText(/Not in \.env\.example/).waitFor() // new keys the template does not know are called out
  const env = readFileSync(join(fixture, 'web-app/.env'), 'utf8')
  assert(env.includes('PORT=4000') && env.includes('# keep this comment') && env.includes('GREETING_MSG="hello world"') && env.includes('API_KEY=sk-test-supersecretvalue123'), `edit damaged the file:\n${env}`)
  await card.getByRole('button', { name: 'Remove GREETING_MSG' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('GREETING_MSG'))
  assert(!readFileSync(join(fixture, 'web-app/.env'), 'utf8').includes('GREETING_MSG'), 'the variable was not removed')
  // the template is listed too, and is not editable
  const tpl = page.getByRole('region', { name: '.env.example', exact: true })
  await tpl.waitFor()
  assert((await tpl.getByRole('button', { name: /^Edit / }).count()) === 0, 'templates must be read-only here')
  await settle(); await page.screenshot({ path: join(shots, '20-env.png') })
})

await step('Script defaults: saved arguments and environment apply, and a file change restarts it', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('web-app').first().click()
  await page.getByRole('tab', { name: 'Scripts' }).click()
  const row = page.locator('div.group', { has: page.locator('span.font-mono', { hasText: /^watchme$/ }) }).first()
  await row.getByRole('button', { name: 'Add arguments' }).click()
  await page.getByRole('textbox', { name: 'Environment variables for watchme' }).fill('GREETING=hello')
  await page.getByRole('button', { name: 'Save as default' }).click()
  await row.getByText('defaults', { exact: true }).waitFor({ timeout: 5000 })
  const savedCfg = Object.entries(JSON.parse(readFileSync(join(userData, 'script-configs.json'), 'utf8')).configs).find(([id]) => id.endsWith(':watchme'))
  assert(savedCfg?.[1].env.GREETING === 'hello', 'defaults were not saved')
  await row.getByRole('button', { name: 'Restart when files change' }).click()
  await row.getByText('watching', { exact: true }).waitFor()

  const latest = () => page.evaluate(async () => (await window.cairix.scripts.runs()).filter((r) => r.scriptId.endsWith(':watchme')))
  const logOf = (id) => page.evaluate((x) => window.cairix.scripts.log(x).then((l) => l.text), id)
  await row.getByRole('button', { name: /^Run$/ }).click()
  let first
  for (let i = 0; i < 100 && !first; i++) {
    const r = (await latest())[0]
    if (r && (await logOf(r.runId)).includes('watch-started hello')) first = r
    else await new Promise((x) => setTimeout(x, 100))
  }
  assert(first, 'the saved environment variable did not reach the script')

  await new Promise((r) => setTimeout(r, 2200)) // past the startup grace period
  const touched = join(fixture, 'web-app/changed.txt')
  writeFileSync(touched, 'edit\n')
  let runs = []
  for (let i = 0; i < 100; i++) {
    runs = await latest()
    if (runs.length >= 2 && runs.some((r) => r.status === 'running' && r.runId !== first.runId)) break
    await new Promise((x) => setTimeout(x, 100))
  }
  assert(runs.length >= 2 && runs.find((r) => r.runId === first.runId).status === 'stopped', `the file change should stop the old run: ${JSON.stringify(runs.map((r) => r.status))}`)
  const second = runs.find((r) => r.status === 'running')
  assert(second && second.runId !== first.runId, 'a new run should have started')
  for (let i = 0; i < 50 && !(await logOf(second.runId)).includes('watch-started hello'); i++) await new Promise((x) => setTimeout(x, 100))
  assert((await logOf(second.runId)).includes('watch-started hello'), 'the restart should keep the saved environment')

  // clean up: switch the watcher off BEFORE touching the file again, then stop and tidy.
  await row.getByRole('button', { name: 'Stop restarting when files change' }).click()
  await row.getByRole('button', { name: /^Stop$/ }).click()
  await row.getByText('Stopped').waitFor({ timeout: 10_000 })
  rmSync(touched, { force: true })
  await page.getByRole('button', { name: 'Clear defaults' }).click()
  await row.getByText('defaults', { exact: true }).waitFor({ state: 'detached', timeout: 5000 })
})

await step('Notifications: a failed run raises one, and clicking it opens the Runs page', async () => {
  // Capture what Electron would show instead of posting real notifications.
  await app.evaluate(({ Notification }) => {
    globalThis.__notes = []
    Notification.prototype.show = function () { globalThis.__notes.push({ title: this.title, body: this.body, n: this }) }
  })
  // Window focus is not reliable under automation: make the test independent of it.
  await page.evaluate(() => window.cairix.settings.set({ notifications: { onlyInBackground: false } }))
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Commands/ }).click()
  await page.getByRole('button', { name: 'Run false again' }).click()
  await page.waitForFunction(() => true)
  let notes = []
  for (let i = 0; i < 100 && notes.length === 0; i++) {
    notes = await app.evaluate(() => globalThis.__notes.map((x) => ({ title: x.title, body: x.body })))
    if (notes.length === 0) await new Promise((r) => setTimeout(r, 100))
  }
  assert(notes.length === 1, `expected one notification, got ${JSON.stringify(notes)}`)
  assert(notes[0].title === 'false failed' && /exit code 1/.test(notes[0].body), `wrong notification: ${JSON.stringify(notes[0])}`)
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
  await app.evaluate(() => globalThis.__notes[0].n.emit('click'))
  await page.getByRole('heading', { name: 'Runs', exact: true }).waitFor({ timeout: 5000 })
})

await step('Notifications: off means silent, and a quiet success is not news', async () => {
  const count = () => app.evaluate(() => globalThis.__notes.length)
  await page.evaluate(() => window.cairix.settings.set({ notifications: { runs: false } }))
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Commands/ }).click()
  await page.getByRole('button', { name: 'Run false again' }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
  await new Promise((r) => setTimeout(r, 1500))
  assert((await count()) === 1, 'a notification was shown with the Scripts category switched off')
  await page.evaluate(() => window.cairix.settings.set({ notifications: { runs: true } }))
  await page.getByRole('button', { name: 'Run echo cairix-rerun-ok again' }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
  await new Promise((r) => setTimeout(r, 1500))
  assert((await count()) === 1, 'a quick successful run should not notify')
})

await step('Auto-restart: a crashing script is brought back, then reported once when it keeps crashing', async () => {
  const notes = () => app.evaluate(() => globalThis.__notes.map((x) => x.title))
  const before = (await notes()).length
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('web-app').first().click()
  await page.getByRole('tab', { name: 'Scripts' }).click()
  const row = page.locator('div.group', { has: page.locator('span.font-mono', { hasText: /^crash$/ }) }).first()
  await row.getByRole('button', { name: 'Restart automatically if it crashes' }).click()
  await row.getByRole('button', { name: 'Turn off auto-restart' }).waitFor()
  await row.getByRole('button', { name: /^Run$/ }).click()
  let titles = []
  for (let i = 0; i < 150 && titles.length <= before; i++) {
    titles = await notes()
    if (titles.length <= before) await new Promise((r) => setTimeout(r, 100))
  }
  assert(titles.length === before + 1, `expected exactly one new notification, got ${JSON.stringify(titles.slice(before))}`)
  assert(titles.at(-1) === 'crash keeps crashing', `wrong notification: ${titles.at(-1)}`)
  await row.getByText('auto-restarted ×5').waitFor({ timeout: 5000 })
  const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
  assert(saved.autoRestartScripts.some((id) => id.endsWith(':crash')), 'auto-restart choice was not saved')
  await settle(); await page.screenshot({ path: join(shots, '18-auto-restart.png') })
  await row.getByRole('button', { name: 'Turn off auto-restart' }).click()
  await row.getByRole('button', { name: 'Restart automatically if it crashes' }).waitFor()
})

await step('Auto-restart: one you stop yourself is left alone', async () => {
  // Stopping is not a crash: nothing may bring it back.
  const row = page.locator('div.group', { has: page.locator('span.font-mono', { hasText: /^serve$/ }) }).first()
  await row.getByRole('button', { name: 'Restart automatically if it crashes' }).click()
  await row.getByRole('button', { name: /^Run$/ }).click()
  await row.getByRole('button', { name: /^Stop$/ }).waitFor({ timeout: 10_000 })
  await row.getByRole('button', { name: /^Stop$/ }).click()
  await row.getByText('Stopped').waitFor({ timeout: 10_000 })
  await new Promise((r) => setTimeout(r, 1200))
  assert((await row.getByText('Stopped').count()) === 1 && (await row.getByRole('button', { name: /^Stop$/ }).count()) === 0, 'a script stopped by the user must not restart')
  assert(!(await canConnect(PORT)), 'the stopped server came back')
  await row.getByRole('button', { name: 'Turn off auto-restart' }).click()
})

await step('Launch at login: a setting, saved, and a dev run never touches your real Login Items', async () => {
  await page.keyboard.press('Meta+Comma')
  const dlg = page.getByRole('dialog', { name: 'Settings' })
  await dlg.waitFor()
  await dlg.getByRole('switch', { name: 'Open Cairix at login' }).click()
  await page.waitForFunction(() => true)
  for (let i = 0; i < 40; i++) {
    if (JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).launchAtLogin === true) break
    await new Promise((r) => setTimeout(r, 100))
  }
  assert(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).launchAtLogin === true, 'launchAtLogin was not saved')
  if (!packaged) {
    const registered = await app.evaluate(({ app: a }) => a.getLoginItemSettings().openAtLogin)
    assert(registered === false, 'a dev run must not register itself as a Login Item')
  }
  await dlg.getByRole('switch', { name: 'Open Cairix at login' }).click()
  await page.keyboard.press('Escape')
})

await step('Runs page keeps finished runs with status, duration and output, and survives a restart of the list', async () => {
  await (page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Runs/ }).click()).catch((e) => { throw new Error('L1: ' + e.message.split('\n')[0]) })
  await (page.getByText('Failed · 1').first().waitFor({ timeout: 5000 })).catch((e) => { throw new Error('L2: ' + e.message.split('\n')[0]) })
  await (page.locator('main span', { hasText: /^Stopped$/ }).first().waitFor()).catch((e) => { throw new Error('L3: ' + e.message.split('\n')[0]) })
  const main = await page.locator('main').innerText()
  assert(/serve/.test(main), 'the earlier dev-server run is missing')
  await (page.locator('button[aria-expanded]').filter({ hasText: 'false' }).first().click()).catch((e) => { throw new Error('L6: ' + e.message.split('\n')[0]) })
  await (page.getByText('[exited with code 1]').waitFor({ timeout: 5000 })).catch((e) => { throw new Error('L7: ' + e.message.split('\n')[0]) })
  await settle(); await page.screenshot({ path: join(shots, '17-runs.png') })
  await page.getByRole('combobox', { name: 'Status' }).selectOption('failed')
  assert((await page.locator('main span', { hasText: /^Succeeded$/ }).count()) === 0, 'status filter should hide successful runs')
  assert((await page.locator('main span', { hasText: /^Failed/ }).count()) >= 1, 'status filter should keep failed runs')
  await page.getByRole('combobox', { name: 'Status' }).selectOption('all')
  await (page.getByRole('radio', { name: 'By script' }).click()).catch((e) => { throw new Error('L13: ' + e.message.split('\n')[0]) })
  await (page.getByText('% ').first().waitFor()).catch((e) => { throw new Error('L14: ' + e.message.split('\n')[0]) })
  const saved = JSON.parse(readFileSync(join(userData, 'run-history.json'), 'utf8'))
  assert(saved.runs.length >= 3 && saved.runs.some((r) => r.status === 'failed'), 'run-history.json should hold the finished runs')
})

await step('Processes page lists a background process and stops it safely', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Processes/ }).click()
  await page.getByRole('radio', { name: 'All mine' }).click()
  const row = page.locator('main div.grid', { hasText: 'sleep 601' }).first()
  await row.waitFor({ timeout: 15_000 })
  const main = await page.locator('main').innerText()
  const offending = main.split('\n').filter((l) => l.includes(join(root, 'node_modules/electron')) || l.trim() === 'launchd')
  assert(offending.length === 0, `Cairix itself (or its helpers) or launchd was listed: ${offending.join(' || ').slice(0, 400)}`)
  await settle(); await page.screenshot({ path: join(shots, '16-processes.png') })
  await row.getByRole('button', { name: /^Stop sleep/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Stop', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('main')?.textContent?.includes('sleep 601'), undefined, { timeout: 10_000 })
  let alive = true
  try { process.kill(bgProc.pid, 0) } catch { alive = false }
  assert(!alive || bgProc.exitCode !== null || bgProc.signalCode !== null, 'the process is still running after Stop')
})

await step('Python script is detected', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('tools').first().click()
  await page.getByText('hello.py').first().waitFor({ timeout: 5000 })
})

await step('Changes: reviews uncommitted code, offers a learn link, and a fix you can preview, apply and undo', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('web-app').first().click()
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('radio', { name: 'Changes' }).click()
  const card = page.getByRole('list', { name: 'Findings' }).getByRole('listitem').filter({ hasText: 'Leftover debugger statement' })
  await card.waitFor({ timeout: 10_000 })
  assert((await card.innerText()).includes('dirty.js:2'), 'finding should point at dirty.js line 2')
  await card.getByRole('button', { name: /Learn: The debugger statement/ }).waitFor()
  assert(await page.getByRole('button', { name: /Review with AI/ }).isVisible(), 'AI review button missing')
  await settle(); await page.screenshot({ path: join(shots, '14-changes.png') })

  await card.getByRole('button', { name: 'Quick fix' }).click()
  const patch = card.getByLabel('Proposed change')
  await patch.waitFor({ timeout: 10_000 })
  assert((await patch.innerText()).includes('debugger'), 'diff preview should show the removed line')
  assert(readFileSync(join(fixture, 'web-app/dirty.js'), 'utf8') === DIRTY, 'previewing must not touch the file')
  await settle(); await page.screenshot({ path: join(shots, '15-changes-preview.png') })

  await card.getByRole('button', { name: 'Apply to my files' }).click()
  await page.getByText('Applied to dirty.js').first().waitFor({ timeout: 10_000 })
  assert(!readFileSync(join(fixture, 'web-app/dirty.js'), 'utf8').includes('debugger'), 'debugger line should be gone after Apply')
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByText('Fix undone').first().waitFor({ timeout: 10_000 })
  assert(readFileSync(join(fixture, 'web-app/dirty.js'), 'utf8') === DIRTY, 'Undo must restore the file exactly')
})

await step('Audit: shows the plan and ceiling first, then runs and lists results with learn links', async () => {
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('radio', { name: 'Audit' }).click()
  const plan = page.getByText(/Will analyse/)
  await plan.waitFor({ timeout: 10_000 })
  assert(/never more than\s*≈?\$0\.15/.test(await plan.innerText()), `plan should state the cost ceiling: ${await plan.innerText()}`)
  await settle(); await page.screenshot({ path: join(shots, '16-audit-plan.png') })
  await page.getByRole('button', { name: 'Run audit' }).click()
  const list = page.getByRole('list', { name: 'Audit findings' })
  await list.getByRole('listitem').filter({ hasText: 'Missing input validation' }).waitFor({ timeout: 15_000 })
  const items = await list.innerText()
  assert(items.includes('Leftover debugger statement'), 'free instant checks should be part of the audit')
  await page.getByText(/must fix/).first().waitFor()
  await settle(); await page.screenshot({ path: join(shots, '17-audit-results.png') })
})

await step('Audit: Claude fix runs in a throwaway copy, previews, applies and undoes', async () => {
  const list = page.getByRole('list', { name: 'Audit findings' })
  const card = list.getByRole('listitem').filter({ hasText: 'Missing input validation' })
  const file = card.locator('p.font-mono').first()
  const rel = (await file.innerText()).split(':')[0] // e.g. dirty.js
  const abs = join(fixture, 'web-app', rel) // finding paths are relative to the git repository root
  const before = readFileSync(abs, 'utf8')
  await card.getByRole('button', { name: 'Fix with Claude' }).click()
  const patch = card.getByLabel('Proposed change')
  await patch.waitFor({ timeout: 20_000 })
  assert((await patch.innerText()).includes('+// reviewed: input is validated'), 'diff preview should show the AI edit')
  assert(readFileSync(abs, 'utf8') === before, 'preview must not touch the real file')
  await card.getByRole('button', { name: 'Apply to my files' }).click()
  // Wait for the Undo button, not the toast: an earlier step's toast can still be on screen.
  await page.getByRole('button', { name: 'Undo' }).waitFor({ timeout: 10_000 })
  { const now = readFileSync(abs, 'utf8'); assert(now === before + '// reviewed: input is validated\n', `Apply should append the line. before=${JSON.stringify(before)} now=${JSON.stringify(now)}`) }
  await page.getByRole('button', { name: 'Undo' }).click()
  await page.getByRole('button', { name: 'Undo' }).waitFor({ state: 'detached', timeout: 10_000 })
  assert(readFileSync(abs, 'utf8') === before, 'Undo must restore the file exactly')
  const wt = execFileSync('git', ['worktree', 'list'], { cwd: join(fixture, 'web-app') }).toString().trim().split('\n')
  assert(wt.length === 1, `throwaway worktree was left behind: ${wt.join(' | ')}`)
})

await step('Actions: invalid templates are explained, valid ones are saved, confirmed, run safely and show output', async () => {
  const side = page.getByRole('complementary', { name: 'Sidebar' })
  await side.getByRole('button', { name: /^Actions/ }).click()
  await page.getByText('No actions yet').first().waitFor()
  await page.getByRole('button', { name: 'Create your first action' }).click()
  const dlg = page.getByRole('dialog', { name: 'New action' })
  await dlg.getByLabel('Action name').fill('Echo branch')
  // {port} does not exist for a project action: the editor must say so, not save it.
  await dlg.getByLabel('Action template').fill('echo {port}')
  await dlg.getByRole('button', { name: 'Save' }).click()
  await dlg.getByText(/\{port\} is not available for project actions/).waitFor()
  await dlg.getByLabel('Action template').fill('echo "branch={branch} project={project.name}"')
  await dlg.getByText('Ask before running').locator('..').locator('..').getByRole('switch').click()
  await settle(); await page.screenshot({ path: join(shots, '18-action-editor.png') })
  await dlg.getByRole('button', { name: 'Save' }).click()
  await page.getByText('Echo branch').first().waitFor()
  assert(JSON.parse(readFileSync(join(userData, 'actions.json'), 'utf8')).actions.length === 1, 'action not persisted')

  await side.getByText('web-app').first().click()
  await page.locator('main').getByRole('button', { name: 'Actions', exact: true }).click()
  await page.getByRole('menuitem', { name: /Echo branch/ }).click()
  const confirm = page.getByRole('dialog', { name: /Run “Echo branch”/ })
  await confirm.waitFor()
  assert((await confirm.innerText()).includes('branch=main project=web-app'), 'confirmation should show the values filled in')
  await settle(); await page.screenshot({ path: join(shots, '19-action-confirm.png') })
  await confirm.getByRole('button', { name: 'Run' }).click()
  const out = page.getByRole('dialog', { name: 'Echo branch' })
  await out.waitFor()
  await page.waitForFunction(() => document.querySelector('.xterm-rows')?.textContent?.includes('branch=main project=web-app'), undefined, { timeout: 10_000 })
  await out.getByText('Done').waitFor({ timeout: 10_000 })
  await settle(); await page.screenshot({ path: join(shots, '20-action-output.png') })
  await out.getByRole('button', { name: 'Close' }).first().click()
})

await step('Dashboard: pin a script, add widgets, reorder by drag and by keyboard, and it persists', async () => {
  const side = page.getByRole('complementary', { name: 'Sidebar' })
  const widgetTitles = async () => (await page.locator('main section[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).filter((t) => t !== 'Getting started')))
  // pin from the Scripts tab
  await side.getByText('web-app').first().click()
  await page.getByRole('tab', { name: 'Scripts' }).click()
  await page.getByRole('button', { name: 'Pin to Home' }).first().click()
  await page.getByRole('button', { name: 'Unpin from Home' }).first().waitFor()

  await side.getByRole('button', { name: 'Home' }).click()
  assert(JSON.stringify(await widgetTitles()) === JSON.stringify(['Overview', 'Running from Cairix', 'Listening now', 'Agents', 'Pending changes']), `default layout wrong: ${await widgetTitles()}`)
  // the cross-project widget sees web-app's uncommitted dirty.js
  const changes = page.locator('section[aria-label="Pending changes"]')
  await changes.getByText('1 changed file').waitFor({ timeout: 20_000 })
  assert((await changes.innerText()).includes('web-app'), 'pending-changes widget should list web-app')

  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('button', { name: 'Add widget' }).click()
  await page.getByRole('menuitem', { name: /Pinned scripts/ }).click()
  const pinned = page.locator('section[aria-label="Pinned scripts"]')
  await pinned.getByText('serve').waitFor({ timeout: 10_000 })
  await settle(); await page.screenshot({ path: join(shots, '21-dashboard-edit.png') })

  // drag "Agents" before "Overview"
  await page.locator('section[aria-label="Agents"]').dragTo(page.locator('section[aria-label="Overview"]'))
  await page.waitForFunction(() => [...document.querySelectorAll('main section[aria-label]')].map((e) => e.getAttribute('aria-label')).filter((t) => t !== 'Getting started')[0] === 'Agents')
  // keyboard: move Agents down one place
  await page.getByRole('button', { name: 'Move Agents down' }).click()
  await page.waitForFunction(() => [...document.querySelectorAll('main section[aria-label]')].map((e) => e.getAttribute('aria-label')).filter((t) => t !== 'Getting started').slice(0, 2).join() === 'Overview,Agents')
  // resize + remove
  await page.getByRole('button', { name: 'Make Pinned scripts full width' }).click()
  await page.getByRole('button', { name: 'Remove Listening now' }).click()
  await page.getByRole('button', { name: 'Done' }).click()

  const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
  assert(saved.dashboard.map((d) => d.type).join() === 'stats,agents,running,changes,pinned', `saved order wrong: ${saved.dashboard.map((d) => d.type)}`)
  assert(saved.dashboard.at(-1).size === 'full' && saved.pinnedScripts.length === 1, 'size/pins not saved')
  await settle(); await page.screenshot({ path: join(shots, '22-dashboard.png') })
  // controls are hidden again outside edit mode
  assert((await page.getByRole('button', { name: /^Move .* up$/ }).count()) === 0, 'edit controls should be hidden after Done')

  // reset restores the default
  await page.getByRole('button', { name: 'Customize' }).click()
  await page.getByRole('button', { name: 'Reset layout' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  assert(JSON.stringify(await widgetTitles()) === JSON.stringify(['Overview', 'Running from Cairix', 'Listening now', 'Agents', 'Pending changes']), 'reset should restore the default layout')
})

await step('Shortcuts: rebind with validation and conflicts, bind a custom action to a key, reset all', async () => {
  const dlg = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  const row = (id) => dlg.locator(`li[data-command="${id}"]`)
  const recorder = (id) => row(id).locator('button').first()
  const saved = () => JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).keybindings

  await page.keyboard.press('Meta+Slash') // the default shortcut for this very dialog
  await dlg.waitFor()
  // a bare key would hijack typing: refused, with the reason
  await recorder('palette.open').click()
  await page.keyboard.press('k')
  await row('palette.open').getByText(/Include ⌘, ⌃ or ⌥/).waitFor()
  // a system-owned combination: refused
  await page.keyboard.press('Meta+KeyC')
  await row('palette.open').getByText(/reserved by the system/).waitFor()
  // a good one is accepted
  await page.keyboard.press('Meta+Shift+KeyP')
  await recorder('palette.open').getByText('⇧⌘P').waitFor()
  assert(JSON.stringify(saved()) === '{"palette.open":"Mod+Shift+P"}', `saved: ${JSON.stringify(saved())}`)
  await settle(); await page.screenshot({ path: join(shots, '23-shortcuts.png') })
  await page.keyboard.press('Escape') // not recording any more: closes the dialog
  await dlg.waitFor({ state: 'detached' })

  // the old key is dead, the new one works
  await page.keyboard.press('Meta+KeyK')
  await page.waitForTimeout(300)
  assert((await page.getByRole('textbox', { name: 'Search commands' }).count()) === 0, 'old shortcut should no longer open the palette')
  await page.keyboard.press('Meta+Shift+KeyP')
  await page.getByRole('textbox', { name: 'Search commands' }).waitFor()
  await page.keyboard.press('Escape')

  // conflict: give that combination to "Add folder" instead
  await page.keyboard.press('Meta+Slash')
  await dlg.waitFor()
  await recorder('folder.add').click()
  await page.keyboard.press('Meta+Shift+KeyP')
  await row('folder.add').getByText(/already used by “Open command palette”/).waitFor()
  await row('folder.add').getByRole('button', { name: 'Use it here instead' }).click()
  await recorder('folder.add').getByText('⇧⌘P').waitFor()
  await recorder('palette.open').getByText('Not set').waitFor()
  assert(JSON.stringify(saved()) === '{"palette.open":"","folder.add":"Mod+Shift+P"}', `saved: ${JSON.stringify(saved())}`)

  // a custom action appears in the list and can be bound; the key then runs it
  await recorder('action:' + JSON.parse(readFileSync(join(userData, 'actions.json'), 'utf8')).actions[0].id).click()
  await page.keyboard.press('Alt+KeyE')
  await dlg.getByText('⌥E').waitFor()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('web-app').first().click()
  await page.keyboard.press('Alt+KeyE')
  await page.getByRole('dialog', { name: /Run “Echo branch”/ }).waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: 'Cancel' }).click()

  // reset everything: defaults are back
  await page.keyboard.press('Meta+Slash')
  await dlg.waitFor()
  await dlg.getByRole('button', { name: 'Reset all' }).click()
  await recorder('palette.open').getByText('⌘K').waitFor()
  assert(JSON.stringify(saved()) === '{}', `saved after reset: ${JSON.stringify(saved())}`)
  await page.getByRole('button', { name: 'Done' }).click()
  await page.keyboard.press('Meta+KeyK')
  await page.getByRole('textbox', { name: 'Search commands' }).waitFor()
  await page.keyboard.press('Escape')
})

await step('Plugins: install, review permissions, run in the sandbox (widget, tab, command, storage), and a hostile plugin cannot escape', async () => {
  const side = page.getByRole('complementary', { name: 'Sidebar' })
  const stubPick = (path) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }) }, path)
  const widgetsOnHome = async () => page.locator('main section[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
  const addWidget = async (name) => {
    await side.getByRole('button', { name: 'Home' }).click()
    await page.getByRole('button', { name: 'Customize' }).click()
    await page.getByRole('button', { name: 'Add widget' }).click()
    await page.getByRole('menuitem', { name: new RegExp(name) }).click()
    await page.getByRole('button', { name: 'Done' }).click()
  }

  // ── install the example; it starts OFF with no permissions ──
  await stubPick(join(root, 'examples/plugin-hello'))
  await side.getByRole('button', { name: /^Plugins/ }).click()
  await page.getByRole('button', { name: 'Install plugin…' }).click()
  const card = page.locator('li', { hasText: 'acme.hello' }).or(page.locator('li').filter({ hasText: 'Hello' })).first()
  await card.getByText('Off').waitFor({ timeout: 10_000 })
  assert(!existsSync(join(userData, 'plugins.json')) || JSON.parse(readFileSync(join(userData, 'plugins.json'), 'utf8'))['acme.hello'] === undefined, 'nothing may be granted before the user enables it')

  // ── the approval step speaks plain language ──
  await card.getByRole('button', { name: 'Enable…' }).click()
  const dlg = page.getByRole('dialog', { name: 'Enable Hello?' })
  const approveText = await dlg.innerText()
  for (const phrase of ['See your projects', 'which dev servers are listening', 'own small data store', 'Show notifications']) assert(approveText.includes(phrase), `approval dialog should say "${phrase}"`)
  await settle(); await page.screenshot({ path: join(shots, '24-plugin-approve.png') })
  await dlg.getByRole('button', { name: 'Allow and enable' }).click()
  await card.getByText('Running').waitFor({ timeout: 15_000 })

  // ── widget on Home, with a click that round-trips through the sandbox into plugin storage ──
  await addWidget('Hello counter')
  const w = page.locator('section[aria-label="Hello counter"]')
  await w.getByText('Projects').waitFor({ timeout: 15_000 })
  assert(/\b5\b/.test(await w.innerText()), `widget should show 5 projects: ${await w.innerText()}`)
  await w.getByRole('button', { name: 'Add one' }).click()
  await page.waitForFunction(() => /Clicks\s*1/.test(document.querySelector('section[aria-label="Hello counter"]')?.textContent ?? ''), undefined, { timeout: 10_000 })
  assert(JSON.parse(readFileSync(join(userData, 'plugin-data/acme.hello.json'), 'utf8')).clicks === 1, 'plugin storage should hold the click count')
  await settle(); await page.screenshot({ path: join(shots, '25-plugin-widget.png') })

  // ── project tab ──
  await side.getByText('web-app').first().click()
  await page.getByRole('tab', { name: 'Hello' }).click()
  // Wait for the plugin's own output (the project's own <h1> also says "web-app").
  await page.getByText('this one').waitFor({ timeout: 15_000 })

  // ── command in the palette ──
  await page.keyboard.press('Meta+KeyK')
  await page.getByRole('textbox', { name: 'Search commands' }).fill('Say hello')
  await page.getByRole('option', { name: /Say hello/ }).click()
  await page.getByText('Hello: Hello from the example plugin!').waitFor({ timeout: 10_000 })

  // ── the hostile plugin: asks for nothing, tries 11 escapes ──
  await stubPick(join(root, 'tests/e2e/fixtures/plugin-rogue'))
  await side.getByRole('button', { name: /^Plugins/ }).click()
  await page.getByRole('button', { name: 'Install plugin…' }).click()
  const rogue = page.locator('li').filter({ hasText: 'Probe' }).first()
  await rogue.getByRole('button', { name: 'Enable…' }).click()
  assert((await page.getByRole('dialog', { name: 'Enable Probe?' }).innerText()).includes('asks for no permissions'), 'dialog should say the plugin asks for nothing')
  await page.getByRole('button', { name: 'Allow and enable' }).click()
  await rogue.getByText('Running').waitFor({ timeout: 15_000 })
  await addWidget('Escape attempts')
  const probe = page.locator('section[aria-label="Escape attempts"]')
  await probe.getByText('load a script from the network').waitFor({ timeout: 20_000 })
  const text = await probe.innerText()
  const blocked = text.split('\n').filter((l) => l.trim() === 'blocked').length // the badge lines only
  assert(!text.includes('ESCAPED') && !text.includes('SUCCEEDED'), `A PLUGIN ESCAPED ITS SANDBOX:\n${text}`)
  assert(blocked === 11, `expected 11 blocked attempts, saw ${blocked}:\n${text}`)
  await settle(); await page.screenshot({ path: join(shots, '26-plugin-rogue-blocked.png') })

  // ── turning a plugin off removes its UI and revokes its access immediately ──
  await side.getByRole('button', { name: /^Plugins/ }).click()
  await card.getByRole('button', { name: 'Turn off' }).click()
  await card.getByText('Off').waitFor()
  await side.getByRole('button', { name: 'Home' }).click()
  await page.waitForFunction(() => !document.querySelector('section[aria-label="Hello counter"]'), undefined, { timeout: 10_000 })
  await side.getByText('web-app').first().click()
  assert((await page.getByRole('tab', { name: 'Hello' }).count()) === 0, 'the plugin tab should disappear when it is turned off')

  // ── uninstalling deletes its data too ──
  await side.getByRole('button', { name: /^Plugins/ }).click()
  await page.getByRole('button', { name: 'Uninstall Hello' }).click()
  await page.getByRole('button', { name: 'Uninstall Probe' }).click()
  await page.getByText('No plugins installed').waitFor({ timeout: 10_000 })
  assert(!existsSync(join(userData, 'plugin-data/acme.hello.json')), "an uninstalled plugin's stored data must be deleted")
  assert(!existsSync(join(userData, 'plugins/acme.hello')), 'plugin files should be removed')
})

await step('Tasks: a read-only task answers; an edit task works in a copy, then you review, apply and undo', async () => {
  const side = page.getByRole('complementary', { name: 'Sidebar' })
  await side.getByText('web-app').first().click()
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('radio', { name: 'Tasks' }).click()
  const box = page.getByLabel('Task for the agent')
  const tasks = page.getByRole('list', { name: 'Tasks' })
  // The composer closes once a task starts; reopen it when it is hidden.
  const openComposer = async () => {
    if (!(await box.isVisible())) await page.getByRole('button', { name: /^New task/ }).click()
    await box.waitFor()
  }

  // read-only
  await openComposer()
  await box.fill('Explain how this project works')
  await page.getByRole('button', { name: 'Start task' }).click()
  const first = tasks.getByRole('listitem').filter({ hasText: 'Explain how this project works' })
  await first.getByText('The project is a tiny HTTP server.').waitFor({ timeout: 15_000 })
  assert((await first.innerText()).includes('Read server.js'), 'the activity feed should show the tool the agent used')
  assert((await first.innerText()).includes('read-only'), 'task should be labelled read-only')

  // edit
  const agentNote = join(fixture, 'web-app/agent-note.txt')
  await openComposer()
  await page.getByRole('radio', { name: 'Make changes' }).click()
  await box.fill('ADD A FILE with a note')
  await page.getByRole('button', { name: 'Start task' }).click()
  const edit = tasks.getByRole('listitem').filter({ hasText: 'ADD A FILE with a note' })
  await edit.getByRole('button', { name: 'Review changes' }).waitFor({ timeout: 15_000 })
  assert(!existsSync(agentNote), 'the agent works in a copy: nothing may land before Apply')
  await settle(); await page.screenshot({ path: join(shots, '27-task-done.png') })
  await edit.getByRole('button', { name: 'Review changes' }).click()
  await edit.getByLabel('Proposed change').waitFor({ timeout: 10_000 })
  assert((await edit.getByLabel('Proposed change').innerText()).includes('written by the fake agent'), 'diff should show the new file content')
  assert(!existsSync(agentNote), 'reviewing must not change files')
  await edit.getByRole('button', { name: 'Apply to my files' }).click()
  await edit.getByText('Applied to your files').waitFor({ timeout: 10_000 })
  assert(readFileSync(agentNote, 'utf8') === 'written by the fake agent\n', 'Apply should create the file')
  await edit.getByRole('button', { name: 'Undo' }).click()
  await edit.getByText('Applied to your files').waitFor({ state: 'detached', timeout: 10_000 })
  for (let i = 0; i < 40 && existsSync(agentNote); i++) await new Promise((r) => setTimeout(r, 50))
  assert(!existsSync(agentNote), 'Undo must remove the file again')
  const wt = execFileSync('git', ['worktree', 'list'], { cwd: join(fixture, 'web-app') }).toString().trim().split('\n')
  assert(wt.length === 1, `throwaway copy left behind: ${wt.join(' | ')}`)
})

await step('Containers: grouped by Compose project, linked to the project, with start/stop and masked logs', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Containers/ }).click()
  const group = page.getByRole('region', { name: 'app', exact: true })
  await group.waitFor({ timeout: 10_000 })
  assert((await group.innerText()).includes('1/2 running') && (await group.innerText()).includes('web-app'), 'the Compose group should show 1/2 running and link to the web-app project')
  await page.getByRole('region', { name: 'Standalone containers' }).getByText('standalone-redis').waitFor()
  await group.getByRole('button', { name: 'Stop app-web-1' }).click()
  await group.getByRole('button', { name: 'Start app-web-1' }).waitFor({ timeout: 10_000 })
  await group.getByText('0/2 running').waitFor()
  await group.getByRole('button', { name: 'Start app-web-1' }).click()
  await group.getByRole('button', { name: 'Restart app-web-1' }).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Logs of app-web-1' }).click()
  const logs = page.getByLabel('Logs of app-web-1', { exact: true }).last()
  await logs.getByText('listening on 3000').waitFor({ timeout: 10_000 })
  const text = await logs.innerText()
  assert(text.includes('slow query') && !text.includes('ghp_abcdef'), 'logs must include stderr and mask tokens')
  await settle(); await page.screenshot({ path: join(shots, '21-containers.png') })
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
})

await step('Git tab: pull request and checks, commit, branch, publish, stash and switch, all from the app', async () => {
  const gitHere = (...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: join(fixture, 'web-app') }).toString().trim()
  const bare = join(fixture, 'remote.git')
  execFileSync('git', ['init', '--bare', '-q', bare])
  gitHere('remote', 'add', 'origin', bare)
  await page.getByRole('complementary', { name: 'Sidebar' }).getByText('web-app').first().click()
  await page.getByRole('tab', { name: 'Git' }).click()
  await page.getByLabel('Current branch').waitFor({ timeout: 10_000 })
  assert((await page.getByLabel('Current branch').innerText()) === 'main', 'should start on main')
  const pr = page.getByRole('region', { name: 'Pull request' })
  await pr.waitFor({ timeout: 10_000 })
  const prText = await pr.innerText()
  assert(prText.includes('#7') && prText.includes('Add e2e coverage') && prText.includes('1 failing') && prText.includes('1 running'), `PR card wrong: ${prText}`)

  // commit everything that is pending (dirty.js is untracked in the fixture)
  await page.getByRole('textbox', { name: 'Commit message' }).fill('e2e: commit from Cairix')
  await page.getByRole('button', { name: 'Commit', exact: true }).click()
  await page.getByText('Working tree clean').waitFor({ timeout: 20_000 })
  assert(gitHere('log', '-1', '--format=%s') === 'e2e: commit from Cairix', 'the commit was not made with that message')
  assert(gitHere('show', '--stat', '--format=', 'HEAD').includes('dirty.js'), 'the pending file should be in the commit')

  // new branch, then publish it (first push sets the upstream)
  await page.getByRole('textbox', { name: 'New branch name' }).fill('feature/e2e')
  await page.getByRole('button', { name: /Create & switch/ }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Current branch"]')?.textContent === 'feature/e2e')
  assert(gitHere('branch', '--show-current') === 'feature/e2e', 'the branch was not created')
  await page.getByRole('button', { name: 'Publish branch' }).click()
  await page.getByRole('button', { name: 'Push', exact: true }).waitFor({ timeout: 20_000 })
  assert(execFileSync('git', ['--git-dir', bare, 'branch', '--list', 'feature/e2e']).toString().includes('feature/e2e'), 'the branch did not reach the remote')

  // stash: untracked work set aside, then brought back
  const note = join(fixture, 'web-app/stash-me.txt')
  writeFileSync(note, 'work in progress\n')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.getByText(/1 new/).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Stash instead' }).click()
  await page.getByRole('region', { name: 'Stashes' }).waitFor({ timeout: 10_000 })
  assert(!existsSync(note), 'stashing should remove the file from the working tree')
  await page.getByRole('button', { name: 'Apply stash 0' }).click()
  await page.getByRole('region', { name: 'Stashes' }).waitFor({ state: 'detached', timeout: 10_000 })
  assert(existsSync(note), 'applying the stash should bring the file back')
  rmSync(note)

  await page.getByRole('button', { name: 'Switch to main' }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="Current branch"]')?.textContent === 'main')
  await settle(); await page.screenshot({ path: join(shots, '22-git.png') })
})

await step('Health tab: version mismatch with a hint, dependency report, and a safe clean', async () => {
  await page.getByRole('tab', { name: 'Health' }).click()
  const tools = page.getByRole('region', { name: 'Tool versions' })
  await tools.getByText('Node').first().waitFor({ timeout: 15_000 })
  const t = await tools.innerText()
  assert(t.includes('.nvmrc') && t.includes('99') && /nvm use/.test(t), `the Node mismatch should be explained: ${t}`)

  await page.getByRole('button', { name: /Check for updates/ }).click()
  const deps = page.getByRole('region', { name: 'Dependencies' })
  await deps.getByText('2 outdated').waitFor({ timeout: 15_000 })
  const d = await deps.innerText()
  assert(d.includes('react') && d.includes('left-pad') && d.includes('1 major') && d.includes('1 high') && d.includes('Prototype Pollution'), `dependency report wrong: ${d}`)

  const disk = page.getByRole('region', { name: 'Disk space' })
  await disk.getByText('node_modules').waitFor()
  await disk.getByRole('button', { name: 'Clean node_modules' }).click()
  const dlg = page.getByRole('dialog', { name: 'Delete node_modules?' })
  assert((await dlg.innerText()).includes('npm install'), 'the dialog should say how to get it back')
  await dlg.getByRole('button', { name: 'Delete' }).click()
  await disk.getByRole('button', { name: 'Clean node_modules' }).waitFor({ state: 'detached', timeout: 15_000 })
  assert(!existsSync(join(fixture, 'web-app/node_modules')), 'node_modules should be gone from disk')
  assert(existsSync(join(fixture, 'web-app/package.json')), 'nothing else may be touched')
  await settle(); await page.screenshot({ path: join(shots, '23-health.png') })
})

await step('Port warning: starting a script whose port is taken offers to free it first', async () => {
  await page.getByRole('tab', { name: 'Scripts' }).click()
  const serve = page.locator('div.group', { has: page.locator('span.font-mono', { hasText: /^serve$/ }) }).first()
  const dev = page.locator('div.group', { has: page.locator('span.font-mono', { hasText: /^devserver$/ }) }).first()
  await serve.getByRole('button', { name: /^Run$/ }).click()
  for (let i = 0; i < 100 && !(await canConnect(PORT)); i++) await new Promise((r) => setTimeout(r, 100))
  assert(await canConnect(PORT), 'the first server should be listening')
  await dev.getByRole('button', { name: /^Run$/ }).click()
  const dlg = page.getByRole('dialog', { name: new RegExp(`Port ${PORT} is already in use`) })
  await dlg.waitFor({ timeout: 10_000 })
  assert((await dlg.innerText()).includes(`--port ${PORT}`), 'the dialog should say why the port is expected')
  await settle(); await page.screenshot({ path: join(shots, '24-port-warning.png') })
  await dlg.getByRole('button', { name: 'Stop it and run' }).click()
  await dev.getByRole('button', { name: /^Stop$/ }).waitFor({ timeout: 15_000 })
  await serve.getByText('Stopped').waitFor({ timeout: 10_000 })
  for (let i = 0; i < 100 && !(await canConnect(PORT)); i++) await new Promise((r) => setTimeout(r, 100))
  assert(await canConnect(PORT), 'the new server should now own the port')
  await dev.getByRole('button', { name: /^Stop$/ }).click()
  await dev.getByText('Stopped').waitFor({ timeout: 10_000 })
})

await step('Logs: search finds matches, and a file path in a stack trace opens in the editor at its line', async () => {
  const row = page.locator('div.group', { has: page.locator('span.font-mono', { hasText: /^trace$/ }) }).first()
  await row.getByRole('button', { name: /^Run$/ }).click()
  await row.getByText('Done').waitFor({ timeout: 15_000 })
  const log = page.getByRole('log', { name: 'Script output' })
  await log.waitFor({ timeout: 10_000 })
  await log.getByText(/findme-needle again/).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Search this log' }).click()
  const box = page.getByRole('textbox', { name: 'Search this log' })
  await box.fill('findme-needle')
  await page.getByText('2 of 2').waitFor({ timeout: 5000 })
  await box.press('Enter')
  await page.getByText('1 of 2').waitFor({ timeout: 5000 })
  await box.fill('zzz-nothing')
  await page.getByText('no matches').waitFor()
  await box.press('Escape')

  // click the stack-trace path: main resolves it inside the project and runs the (fake) editor with --goto
  await page.locator('div[role="status"]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => undefined) // a toast can sit on top of the log
  const target = log.getByText(/server\.js:3:5/).first()
  const box2 = await target.boundingBox()
  const x = box2.x + box2.width * 0.85 // the path is at the end of the line
  const y = box2.y + box2.height / 2
  await page.mouse.move(x - 20, y)
  await page.mouse.move(x, y, { steps: 5 })
  await new Promise((r) => setTimeout(r, 300)) // xterm resolves links on hover
  await page.mouse.click(x, y)
  let opened = ''
  for (let i = 0; i < 50 && !opened.includes('server.js:3:5'); i++) {
    opened = readFileSync(editorLog, 'utf8')
    if (!opened.includes('server.js:3:5')) await new Promise((r) => setTimeout(r, 100))
  }
  assert(opened.includes('--goto') && opened.includes(join(fixture, 'web-app', 'server.js') + ':3:5'), `the editor was not asked to open the file at the line: ${opened}`)
})

await step('Schedules: create, run now, and a branch change triggers one', async () => {
  const lintRuns = () => page.evaluate(async () => (await window.cairix.scripts.runs()).filter((r) => r.scriptId.endsWith(':lint')).length)
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: /^Schedules/ }).click()
  await page.getByText('Nothing scheduled').waitFor({ timeout: 10_000 })

  async function create(name, when) {
    await page.getByRole('button', { name: /New schedule|Create a schedule/ }).first().click()
    const dlg = page.getByRole('dialog', { name: 'New schedule' })
    await dlg.getByRole('textbox', { name: 'Schedule name' }).fill(name)
    await dlg.getByRole('combobox', { name: 'Project', exact: true }).selectOption({ label: 'web-app' })
    await dlg.getByRole('combobox', { name: 'Script' }).selectOption({ label: 'lint' })
    if (when) {
      await dlg.getByRole('radio', { name: when }).click()
      if (when === 'When a branch changes') await dlg.getByRole('combobox', { name: 'Project to watch' }).selectOption({ label: 'web-app' })
    }
    await dlg.getByRole('button', { name: 'Save' }).click()
    await dlg.waitFor({ state: 'detached' })
  }

  await create('e2e interval', 'Every…')
  const list = page.getByRole('list', { name: 'Schedules' })
  const item = list.getByRole('listitem').filter({ hasText: 'e2e interval' })
  await item.getByText('Every 30 minutes').waitFor()
  await item.getByText('Has not run yet').waitFor()
  const before = await lintRuns()
  await item.getByRole('button', { name: 'Run e2e interval now' }).click()
  await item.getByText(/Started lint/).waitFor({ timeout: 10_000 })
  assert((await lintRuns()) === before + 1, 'Run now should start the lint script')

  await create('e2e on commit', 'When a branch changes')
  await new Promise((r) => setTimeout(r, 1500)) // let it take its baseline of the repository
  const mid = await lintRuns()
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--allow-empty', '-q', '-m', 'trigger a schedule'], { cwd: join(fixture, 'web-app') })
  for (let i = 0; i < 100 && (await lintRuns()) === mid; i++) await new Promise((r) => setTimeout(r, 100))
  assert((await lintRuns()) === mid + 1, 'a new commit should have started the schedule')
  await list.getByRole('listitem').filter({ hasText: 'e2e on commit' }).getByText(/the branch changed/).waitFor({ timeout: 5000 })

  // pause stops it from firing; deleting removes it
  await list.getByRole('listitem').filter({ hasText: 'e2e on commit' }).getByRole('switch').click()
  await list.getByRole('listitem').filter({ hasText: 'e2e on commit' }).getByText(/paused/).waitFor()
  await settle(); await page.screenshot({ path: join(shots, '25-schedules.png') })
  for (const n of ['e2e interval', 'e2e on commit']) await page.getByRole('button', { name: `Delete ${n}` }).click()
  await page.getByText('Nothing scheduled').waitFor({ timeout: 5000 })
})

await step('Keymap: only the running system’s shortcuts, searchable', async () => {
  const side = page.getByRole('complementary', { name: 'Sidebar' })
  await side.getByText('Learn', { exact: true }).waitFor()
  await side.getByRole('button', { name: /^Daily learn/ }).waitFor()
  await side.getByRole('button', { name: /^Keymap/ }).click()
  const label = process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : 'Linux'
  await page.getByRole('heading', { name: new RegExp(`^Keymap\\s*${label}$`) }).waitFor({ timeout: 10_000 })
  const keys = await page.locator('main kbd').allInnerTexts()
  assert(keys.length > 50, `expected a full keymap, got ${keys.length} keys`)
  if (process.platform === 'darwin') {
    assert(keys.includes('⌘') && keys.includes('⇧') && keys.includes('⌥'), 'macOS shortcuts should use ⌘ ⇧ ⌥')
    assert(!keys.some((k) => ['Win', 'Alt', 'Super'].includes(k)), 'Windows/Linux keys must not appear on a Mac')
    assert((await page.locator('main').innerText()).includes('Screenshot of a selection'), 'macOS screenshot shortcut missing')
  }
  await page.getByRole('textbox', { name: 'Find a shortcut' }).fill('delete word')
  await page.waitForFunction(() => document.querySelectorAll('main li').length > 0 && document.querySelectorAll('main li').length < 6)
  assert(/delete the previous word/i.test(await page.locator('main').innerText()), 'search should find "Delete the previous word"')
  await page.getByRole('textbox', { name: 'Find a shortcut' }).fill('zzzz')
  await page.getByText('No shortcut matches that').waitFor()
  await settle(); await page.screenshot({ path: join(shots, '26-keymap.png') })
})

await step('Daily learn: choose topics and level in Settings, then Claude writes today’s lesson', async () => {
  const side = page.getByRole('complementary', { name: 'Sidebar' })
  await side.getByRole('button', { name: /^Daily learn/ }).click()
  await page.getByText('Pick what you want to learn').waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: 'Choose topics' }).click()
  const dlg = page.getByRole('dialog', { name: 'Settings' })
  await dlg.waitFor()
  await dlg.getByRole('group', { name: 'Tools' }).getByRole('button', { name: 'Git', exact: true }).click()
  await dlg.getByRole('group', { name: 'Languages' }).getByRole('button', { name: 'TypeScript', exact: true }).click()
  await dlg.getByRole('textbox', { name: 'Add your own topic' }).fill('Kubernetes')
  await dlg.getByRole('textbox', { name: 'Add your own topic' }).press('Enter')
  await dlg.getByRole('radio', { name: 'Advanced' }).click()
  for (let i = 0; i < 40; i++) {
    const l = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).learn
    if (l?.topics?.length === 3 && l.level === 'advanced') break
    await new Promise((r) => setTimeout(r, 100))
  }
  const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).learn
  assert(JSON.stringify(saved.topics) === JSON.stringify(['Git', 'TypeScript', 'Kubernetes']) && saved.level === 'advanced' && saved.autoGenerate === true, `learning settings not saved: ${JSON.stringify(saved)}`)
  await page.waitForTimeout(1500)
  assert(!existsSync(join(userData, 'learn.json')), 'no lesson may be written while still choosing topics in Settings')
  await page.keyboard.press('Escape')

  // closing Settings is what starts today's lesson, for today's topic, at the chosen level
  const header = page.locator('main p', { hasText: /^Today:/ })
  await header.waitFor({ timeout: 10_000 })
  const topic = (await header.innerText()).match(/Today:\s*(.+?)\s*·\s*Advanced/)?.[1]
  assert(topic && ['Git', 'TypeScript', 'Kubernetes'].includes(topic), `today's topic should be one of the chosen ones: ${await header.innerText()}`)
  const lesson = page.getByRole('article')
  await lesson.waitFor({ timeout: 20_000 })
  const text = await lesson.innerText()
  assert(text.includes(`${topic}: lesson 1 (advanced)`), `the lesson should be about ${topic} at the advanced level: ${text.slice(0, 120)}`)
  assert(/key points/i.test(text) && text.includes('echo "hello from the lesson"') && /try it/i.test(text), 'the lesson is missing its parts')
  await settle(); await page.screenshot({ path: join(shots, '27-learn.png') })

  // the quiz: a question whose answer is not among its options is never shown
  const quiz = page.getByRole('region', { name: 'Quick quiz' })
  const qt = await quiz.innerText()
  assert(qt.includes('Which is the best first step?') && !qt.includes('broken answer index'), `quiz wrong: ${qt}`)
  await quiz.getByRole('button', { name: 'Guess' }).click()
  await quiz.getByText('Reading first saves time.').waitFor()
  await quiz.getByText('You got 0 of 1.').waitFor()

  // mark as learned: streak starts
  await page.getByRole('button', { name: 'Mark as learned' }).click()
  await page.getByText('1-day streak').waitFor({ timeout: 5000 })
  await page.getByRole('button', { name: /Learned ✓/ }).waitFor()

  // another lesson on the same topic avoids repeating the first
  await page.getByRole('button', { name: `Another lesson on ${topic}` }).click()
  await page.getByRole('article').getByText(`${topic}: lesson 2 (advanced)`).first().waitFor({ timeout: 20_000 })
  await page.getByRole('region', { name: 'Earlier lessons' }).getByText(`${topic}: lesson 1 (advanced)`).waitFor()
  const store = JSON.parse(readFileSync(join(userData, 'learn.json'), 'utf8'))
  assert(store.lessons.length === 2 && store.lessons[1].learned === true && store.lessons[0].learned === false, 'lessons were not persisted correctly')
})

await step('command palette finds and runs a script', async () => {
  await page.keyboard.press('Meta+KeyK')
  const input = page.getByRole('textbox', { name: 'Search commands' })
  await input.waitFor({ timeout: 3000 })
  await input.fill('build')
  await page.getByRole('option', { name: /Run build/ }).first().waitFor({ timeout: 5000 })
  await settle(); await page.screenshot({ path: join(shots, '10-palette.png') })
  await page.keyboard.press('Escape')
  await input.waitFor({ state: 'detached' })
})

await step('settings: dark theme and accent apply', async () => {
  await page.keyboard.press('Meta+Comma')
  const dlg = page.getByRole('dialog', { name: 'Settings' })
  await dlg.waitFor()
  await dlg.getByRole('radio', { name: 'Dark' }).click()
  await dlg.getByRole('radio', { name: 'violet' }).click()
  await page.waitForFunction(() => document.documentElement.dataset.accent === 'violet')
  // The theme is applied by main (nativeTheme) and reaches the page asynchronously.
  await page
    .waitForFunction(() => matchMedia('(prefers-color-scheme: dark)').matches, undefined, { timeout: 5000 })
    .catch(() => {
      throw new Error('prefers-color-scheme never became dark after choosing Dark')
    })
  await settle(); await page.screenshot({ path: join(shots, '11-settings-dark.png') })
  await page.keyboard.press('Escape')
})

await step('dark Ports/Home views render', async () => {
  await page.getByRole('complementary', { name: 'Sidebar' }).getByRole('button', { name: 'Home' }).click()
  await page.getByText('Everything running on this Mac').waitFor()
  await settle(); await page.screenshot({ path: join(shots, '12-home-dark.png') })
})

await step('state persisted to disk', async () => {
  const projects = JSON.parse(readFileSync(join(userData, 'projects.json'), 'utf8'))
  assert(projects.workspaces[0].projects.length === 5 && projects.workspaces[0].trusted === true, 'projects.json is wrong')
  const settings = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'))
  assert(settings.theme === 'dark' && settings.accent === 'violet', `settings.json is wrong: ${JSON.stringify(settings)}`)
})

await step('no renderer console errors', async () => {
  const real = consoleErrors.filter((e) => !/Autofill|DevTools/.test(e))
  assert(real.length === 0, real.join(' | '))
})

// ───────────────────────── teardown ─────────────────────────

await app.close()
await new Promise((r) => setTimeout(r, 500))
await step('quitting Cairix leaves no server behind', async () => {
  assert(!(await canConnect(PORT)), 'dev server survived app quit')
})
agentProc.kill()
bgProc.kill()
rmSync(fixture, { recursive: true, force: true })
rmSync(userData, { recursive: true, force: true })
rmSync(fakeHome, { recursive: true, force: true })
rmSync(dockerState, { force: true })
rmSync(editorLog, { force: true })

console.log(`\n${failures === 0 ? 'PASS' : `FAIL (${failures})`}: ${log.length} steps. Screenshots: ${shots}`)
process.exit(failures === 0 ? 0 : 1)
