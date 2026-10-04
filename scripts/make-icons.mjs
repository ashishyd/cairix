/**
 * Generates every icon Cairix ships from the SVG sources in build/:
 *   build/icon.icns          macOS app icon (all sizes, via iconutil)
 *   build/icon.png           1024px master
 *   resources/icon.png       512px, used for the Dock icon in development
 *   resources/trayTemplate(@2x).png   menu bar glyph (monochrome template image)
 *
 * Usage: pnpm icons        (macOS only: needs iconutil)
 * Sizes up to 64px use the simplified mark (build/icon-source-small.svg).
 */
import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = createRequire(import.meta.url)('electron') // path to the electron binary
const full = join(root, 'build/icon-source.svg')
const small = join(root, 'build/icon-source-small.svg')
const tray = join(root, 'build/tray-icon-source.svg')
const iconset = join(root, 'build/icon.iconset')

// iconutil expects exactly these names.
const ICONSET = [
  ['icon_16x16.png', 16],
  ['icon_16x16@2x.png', 32],
  ['icon_32x32.png', 32],
  ['icon_32x32@2x.png', 64],
  ['icon_128x128.png', 128],
  ['icon_128x128@2x.png', 256],
  ['icon_256x256.png', 256],
  ['icon_256x256@2x.png', 512],
  ['icon_512x512.png', 512],
  ['icon_512x512@2x.png', 1024]
]

rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })
mkdirSync(join(root, 'resources'), { recursive: true })

const jobs = [
  ...ICONSET.map(([name, size]) => ({ svg: size <= 64 ? small : full, size, out: join(iconset, name) })),
  { svg: full, size: 1024, out: join(root, 'build/icon.png') },
  { svg: full, size: 512, out: join(root, 'resources/icon.png') },
  { svg: tray, size: 18, out: join(root, 'resources/trayTemplate.png') },
  { svg: tray, size: 36, out: join(root, 'resources/trayTemplate@2x.png') }
]

console.log(`Rendering ${jobs.length} images with Electron…`)
// Electron may be started by another Electron app (e.g. a desktop IDE) that sets
// ELECTRON_RUN_AS_NODE, which would make it run as plain Node and skip rendering.
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
execFileSync(electron, [join(root, 'scripts/rasterize.cjs'), JSON.stringify(jobs)], { stdio: 'inherit', env })

// Don't trust the exit code alone: check that every image was actually written.
const missing = jobs.filter((j) => !existsSync(j.out) || statSync(j.out).size < 100)
if (missing.length > 0) {
  console.error('These images were not produced:\n' + missing.map((j) => '  ' + j.out).join('\n'))
  process.exit(1)
}

execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')], { stdio: 'inherit' })
rmSync(iconset, { recursive: true, force: true })
console.log('Done: build/icon.icns, build/icon.png, resources/icon.png, resources/trayTemplate*.png')
