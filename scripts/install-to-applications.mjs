// Installs the freshly built Cairix.app into /Applications.
//   node scripts/install-to-applications.mjs [--dest <dir>] [--dry-run] [--no-quit] [--open]
import { existsSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'
import os from 'os'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n)
const destDir = args.includes('--dest') ? args[args.indexOf('--dest') + 1] : '/Applications'
const dryRun = flag('--dry-run')
const arch = os.arch() // 'arm64' | 'x64'
const distDir = 'dist'
const appName = 'Cairix'
const destPath = join(destDir, `${appName}.app`)

if (!destDir || !existsSync(destDir)) {
  console.error(`Destination folder does not exist: ${destDir}`)
  process.exit(1)
}

// Install from the .zip, not dist/mac-*/Cairix.app: the unpacked app has absolute
// symlinks into dist/ that break once dist/ changes ("Library not loaded" at launch).
// The zip stores relative links, so `ditto -xk` gives a self-contained app.
const zips = existsSync(distDir)
  ? readdirSync(distDir)
      .filter((f) => f.endsWith('-mac.zip') && (arch === 'arm64' ? f.includes('-arm64-mac.zip') : !f.includes('-arm64-mac.zip')))
      .map((f) => ({ f, t: statSync(join(distDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
  : []
if (zips.length === 0) {
  console.error(`No built mac .zip for ${arch} under ${distDir}/. Run "pnpm deploy:mac" to build and install.`)
  process.exit(1)
}
const zipPath = join(distDir, zips[0].f)
console.log(`Source:      ${zipPath}\nDestination: ${destPath}`)
if (dryRun) {
  console.log('Dry run: nothing changed.')
  process.exit(0)
}

// Quit a running copy first so the bundle isn't replaced under it.
if (!flag('--no-quit') && existsSync(destPath)) {
  try {
    execFileSync('osascript', ['-e', `tell application "${appName}" to quit`], { stdio: 'ignore', timeout: 8000 })
  } catch { /* not running */ }
  for (let i = 0; i < 20; i++) {
    let running = true
    try { execFileSync('pgrep', ['-f', `${destPath}/Contents/MacOS/`], { stdio: 'ignore' }) } catch { running = false }
    if (!running) break
    execFileSync('sleep', ['0.5'])
  }
}

rmSync(destPath, { recursive: true, force: true })
execFileSync('ditto', ['-xk', zipPath, destDir], { stdio: 'inherit' })
// Local, unsigned build: clear any quarantine flag so Gatekeeper doesn't block the first launch.
try { execFileSync('xattr', ['-dr', 'com.apple.quarantine', destPath], { stdio: 'ignore' }) } catch { /* none set */ }
console.log(`Installed ${appName} -> ${destPath}`)
if (flag('--open')) execFileSync('open', [destPath])
