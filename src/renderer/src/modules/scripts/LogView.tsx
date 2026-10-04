import { useEffect, useRef } from 'react'
import type { RunOutputEvent } from '@shared/types'

/**
 * Reads a `--cx-*` colour channel triple ("17 24 39") as a comma-separated
 * `rgba()`. xterm only understands the classic comma syntax: the modern
 * `rgb(17 24 39 / .9)` form is silently ignored and it falls back to white,
 * which is invisible on a light theme.
 */
function token(name: string, alpha = 1): string {
  const channels = getComputedStyle(document.documentElement).getPropertyValue(`--cx-${name}`).trim().split(/\s+/)
  return `rgba(${channels.join(', ')}, ${alpha})`
}

/** xterm's built-in ANSI colours assume a dark background; "white" output vanishes on a light one. */
const ANSI_LIGHT = {
  black: '#1f2430', red: '#c0392b', green: '#1a7f4b', yellow: '#9a6700', blue: '#1f5fd0', magenta: '#8250df', cyan: '#0a7c86', white: '#6b7280',
  brightBlack: '#6b7280', brightRed: '#e5484d', brightGreen: '#2fa66a', brightYellow: '#b7791f', brightBlue: '#3b82f6', brightMagenta: '#a371f7', brightCyan: '#1ba5b0', brightWhite: '#374151'
}
const ANSI_DARK = {
  black: '#3b4261', red: '#f87171', green: '#34d399', yellow: '#fbbf24', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#22d3ee', white: '#c0caf5',
  brightBlack: '#7a85a8', brightRed: '#fca5a5', brightGreen: '#6ee7b7', brightYellow: '#fcd34d', brightBlue: '#93b4ff', brightMagenta: '#d0b8ff', brightCyan: '#67e8f9', brightWhite: '#e8ecf5'
}

function terminalTheme(): Record<string, string> {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return {
    ...(dark ? ANSI_DARK : ANSI_LIGHT),
    background: 'rgba(0, 0, 0, 0)',
    foreground: token('text', 0.92),
    cursor: 'rgba(0, 0, 0, 0)',
    selectionBackground: token('accent', 0.35)
  }
}

/**
 * Read-only terminal for one run. xterm is loaded lazily (it is the heaviest
 * dependency in the app and most sessions never open a log).
 *
 * Attaching mid-stream is the tricky part: output arrives as events while we
 * fetch the log so far. Every event carries the run's character offset, and the
 * snapshot says how long the log is, so each chunk is applied exactly once and
 * in order, with no duplicated or dropped lines.
 */
export function LogView({ runId }: { runId: string }): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let cleanup = (): void => undefined

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')])
      if (disposed || !host.current) return

      const term = new Terminal({
        convertEol: true,
        disableStdin: true,
        scrollback: 10_000,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
        fontSize: 12,
        lineHeight: 1.3,
        cursorBlink: false,
        allowTransparency: true,
        theme: terminalTheme()
      })
      const fit = new FitAddon()
      term.loadAddon(fit)
      term.open(host.current)
      const refit = (): void => {
        try {
          fit.fit()
        } catch {
          /* container not laid out yet */
        }
      }
      refit()

      let cursor = -1 // unknown until the snapshot arrives
      const queue: RunOutputEvent[] = []
      const apply = (e: RunOutputEvent): void => {
        const end = e.offset + e.chunk.length
        if (end <= cursor) return // already in the snapshot
        term.write(e.offset >= cursor ? e.chunk : e.chunk.slice(cursor - e.offset))
        cursor = end
      }

      const off = window.cairix.scripts.onOutput((e) => {
        if (e.runId !== runId) return
        if (cursor < 0) queue.push(e)
        else apply(e)
      })

      const resize = new ResizeObserver(refit)
      resize.observe(host.current)
      const scheme = window.matchMedia('(prefers-color-scheme: dark)')
      const retheme = (): void => {
        term.options.theme = terminalTheme()
      }
      scheme.addEventListener('change', retheme)

      cleanup = () => {
        off()
        resize.disconnect()
        scheme.removeEventListener('change', retheme)
        term.dispose()
      }
      if (disposed) return cleanup()

      const snap = await window.cairix.scripts.log(runId)
      if (disposed) return
      term.write(snap.text)
      cursor = snap.length
      queue.forEach(apply)
      queue.length = 0
    })()

    return () => {
      disposed = true
      cleanup()
    }
  }, [runId])

  return <div ref={host} className="selectable h-full w-full overflow-hidden" aria-label="Script output" role="log" />
}
