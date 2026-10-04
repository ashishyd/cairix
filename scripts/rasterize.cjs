/**
 * Renders SVG files to transparent PNGs using Electron's own renderer.
 * Run by make-icons.mjs:  electron scripts/rasterize.cjs '<json jobs>'
 * jobs = [{ svg, size, out }]
 *
 * Why Electron: `qlmanage` flattens onto white and `sips` can't read SVG, and
 * Electron is already a dependency. It renders true alpha at an exact pixel size.
 *
 * One 1024px offscreen window is reused for every job: the SVG is swapped in
 * place (navigating a second window to a data: URL fails), rendered in the
 * top-left corner at the requested size, and that corner is cropped out.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

const MAX = 1024
const jobs = JSON.parse(process.argv[process.argv.length - 1])
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    const win = new BrowserWindow({
      width: MAX,
      height: MAX,
      show: false,
      frame: false,
      transparent: true,
      useContentSize: true,
      webPreferences: { offscreen: true, backgroundThrottling: false }
    })

    let latest = null
    win.webContents.on('paint', (_e, _dirty, image) => {
      // Only whole-window frames: partial (dirty-rect) frames can't be cropped reliably.
      const s = image.getSize()
      if (s.width === MAX && s.height === MAX) latest = image
    })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><body style="margin:0;background:transparent;overflow:hidden"></body>'))

    for (const { svg, size, out } of jobs) {
      const markup = fs.readFileSync(svg, 'utf8').replace(/<\?xml[^>]*\?>/, '').replace('<svg', `<svg width="${size}" height="${size}" style="display:block"`)
      latest = null
      await win.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(markup)}`)
      for (let i = 0; i < 12 && !latest; i++) {
        win.webContents.invalidate()
        await sleep(100)
      }
      if (!latest) throw new Error(`no full frame rendered for ${svg} @${size}`)
      await sleep(150) // let the freshly set markup land in the next frame
      latest = null
      for (let i = 0; i < 12 && !latest; i++) {
        win.webContents.invalidate()
        await sleep(100)
      }
      if (!latest) throw new Error(`no settled frame rendered for ${svg} @${size}`)
      fs.mkdirSync(path.dirname(out), { recursive: true })
      fs.writeFileSync(out, latest.crop({ x: 0, y: 0, width: size, height: size }).toPNG())
    }
    app.exit(0)
  } catch (err) {
    console.error(err)
    app.exit(1)
  }
})
