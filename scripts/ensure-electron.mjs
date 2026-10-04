/**
 * pnpm sometimes skips Electron's own postinstall (which downloads the binary),
 * leaving `node_modules/electron/dist` missing and every dev/build command broken
 * with a confusing error. Make sure the binary is there after any install.
 */
import { existsSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { execFileSync } from 'child_process'

const require = createRequire(import.meta.url)
try {
  const pkgDir = dirname(require.resolve('electron/package.json'))
  if (!existsSync(join(pkgDir, 'path.txt')) || !existsSync(join(pkgDir, 'dist'))) {
    console.log('Downloading the Electron binary…')
    execFileSync(process.execPath, [join(pkgDir, 'install.js')], { stdio: 'inherit' })
  }
} catch (err) {
  console.warn('ensure-electron: skipped (' + (err instanceof Error ? err.message : err) + ')')
}
