/**
 * Screenshots the REAL Cairix window (macOS vibrancy, traffic lights, native
 * chrome) in light and dark, which Playwright's page screenshots cannot show.
 *
 *   pnpm build && node tests/e2e/native-shot.mjs [outDir]
 *
 * Captures only the Cairix window by id (`screencapture -l`), never the desktop.
 * Needs Screen Recording permission for the terminal/app running it.
 */
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = resolve(process.argv[2] ?? join(root, 'tests/e2e/shots'))
mkdirSync(out, { recursive: true })

// Compile the tiny window-id helper once.
const helper = join(tmpdir(), 'cairix-window-id')
if (!existsSync(helper)) execFileSync('swiftc', ['-O', join(root, 'tests/e2e/window-id.swift'), '-o', helper])

const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'cairix-native-')))
for (const [name, scripts] of [['web-app', { dev: 'next dev', build: 'next build', test: 'vitest' }], ['api', { dev: 'tsx watch src/index.ts', start: 'node dist/index.js' }]]) {
  mkdirSync(join(fixture, name), { recursive: true })
  writeFileSync(join(fixture, name, 'package.json'), JSON.stringify({ name, scripts }))
}
const userData = mkdtempSync(join(tmpdir(), 'cairix-native-ud-'))
const env = { ...process.env, CAIRIX_USER_DATA: userData, CAIRIX_HOME: fixture }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({ executablePath: createRequire(import.meta.url)('electron'), args: [root], env })
const page = await app.firstWindow()
await page.emulateMedia({ colorScheme: null })
await page.waitForLoadState('domcontentloaded')

await app.evaluate(({ dialog }, p) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
}, fixture)
await page.getByRole('button', { name: 'Add folder…' }).first().click()
await page.getByRole('dialog', { name: 'Add a folder' }).getByText('Trust this folder').click()
await page.getByRole('button', { name: /^Add 2 projects$/ }).click()
await page.getByRole('complementary', { name: 'Sidebar' }).getByText('api').first().click()
await page.getByText('Run', { exact: true }).first().waitFor()

const pid = app.process().pid
async function shot(theme, file) {
  await page.evaluate((t) => window.cairix.settings.set({ theme: t }), theme)
  await page.waitForFunction((t) => matchMedia('(prefers-color-scheme: dark)').matches === (t === 'dark'), theme)
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.show()
    w.focus()
  })
  await new Promise((r) => setTimeout(r, 900)) // let vibrancy and the theme settle
  const id = execFileSync(helper, [String(pid)]).toString().trim()
  execFileSync('screencapture', ['-l', id, '-o', '-x', join(out, file)])
  console.log('captured', file)
}
await shot('light', 'native-light.png')
await shot('dark', 'native-dark.png')

await app.close()
rmSync(fixture, { recursive: true, force: true })
rmSync(userData, { recursive: true, force: true })
