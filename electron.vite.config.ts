import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { contentSecurityPolicy } from './src/shared/csp'

const shared = resolve('src/shared')

/**
 * Production loads the page from file://, where response headers don't exist,
 * so the strict policy ships as a <meta> tag. Dev serves over http and gets
 * the (looser, HMR-friendly) policy as a header from the main process instead.
 */
function cspMeta(): Plugin {
  return {
    name: 'cairix-csp-meta',
    transformIndexHtml(html, ctx) {
      const tag = ctx.server
        ? ''
        : `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(false)}" />`
      return html.replace('<!--cx-csp-->', tag)
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': shared } }
  },
  preload: {
    resolve: { alias: { '@shared': shared } },
    // Two preloads: one for the app window, one for each sandboxed plugin window.
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts'), plugin: resolve('src/preload/plugin.ts') } } }
  },
  renderer: {
    resolve: { alias: { '@': resolve('src/renderer/src'), '@shared': shared } },
    plugins: [react(), cspMeta()],
    css: { postcss: resolve('postcss.config.js') },
    // electron-vite leaves minification off by default; the UI bundle should ship minified.
    build: { minify: 'esbuild' }
  }
})
