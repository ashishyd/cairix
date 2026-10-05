import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { findFileRefs } from '@shared/log-links'
import type { RunOutputEvent } from '@shared/types'
import { IconButton } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'

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
  const termRef = useRef<import('@xterm/xterm').Terminal | null>(null)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<Array<{ row: number; col: number }>>([])
  const [at, setAt] = useState(0)

  // Finds every match in the terminal's buffer (scrollback included), case-insensitively.
  function scan(q: string): Array<{ row: number; col: number }> {
    const term = termRef.current
    if (!term || !q) return []
    const buf = term.buffer.active
    const needle = q.toLowerCase()
    const found: Array<{ row: number; col: number }> = []
    for (let row = 0; row < buf.length && found.length < 5000; row++) {
      const text = buf.getLine(row)?.translateToString(true).toLowerCase() ?? ''
      for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) found.push({ row, col: i })
    }
    return found
  }

  function show(list: Array<{ row: number; col: number }>, index: number): void {
    const term = termRef.current
    const m = list[index]
    if (!term || !m) return term?.clearSelection()
    term.select(m.col, m.row, query.length)
    term.scrollToLine(Math.max(0, m.row - 3))
    setAt(index)
  }

  function search(q: string): void {
    setQuery(q)
    const list = scan(q)
    setMatches(list)
    // Start from the newest match: that is nearly always the one you want in a log.
    const term = termRef.current
    const m = list.at(-1)
    if (term && m) {
      term.select(m.col, m.row, q.length)
      term.scrollToLine(Math.max(0, m.row - 3))
    } else term?.clearSelection()
    setAt(Math.max(0, list.length - 1))
  }

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
      termRef.current = term

      // File paths in stack traces open at their line in your editor. Main checks the file is inside the project.
      term.registerLinkProvider({
        provideLinks(y, callback) {
          const text = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? ''
          const refs = findFileRefs(text)
          callback(
            refs.length === 0
              ? undefined
              : refs.map((r) => ({
                  range: { start: { x: r.start + 1, y }, end: { x: r.end, y } },
                  text: text.slice(r.start, r.end),
                  activate: () => {
                    window.cairix.scripts.openFile(runId, r.path, r.line, r.column).catch((e) => toast.error(errMsg(e)))
                  }
                }))
          )
        }
      })

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
        termRef.current = null
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

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-center justify-end gap-1 px-1 pb-1">
        {searching ? (
          <>
            <input
              autoFocus
              value={query}
              onChange={(e) => search(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setSearching(false)
                  termRef.current?.clearSelection()
                } else if (e.key === 'Enter' && matches.length > 0) show(matches, (at + (e.shiftKey ? matches.length - 1 : 1)) % matches.length)
              }}
              placeholder="Search this log"
              aria-label="Search this log"
              className="no-drag h-6 w-48 rounded-md border border-cx-border bg-cx-raised px-2 text-sm outline-none focus:border-cx-accent"
            />
            <span className="w-16 text-right text-xs tabular-nums text-cx-faint" aria-live="polite">{query ? (matches.length === 0 ? 'no matches' : `${at + 1} of ${matches.length}`) : ''}</span>
            <IconButton icon={ChevronUp} label="Previous match" size={14} disabled={matches.length === 0} onClick={() => show(matches, (at + matches.length - 1) % matches.length)} />
            <IconButton icon={ChevronDown} label="Next match" size={14} disabled={matches.length === 0} onClick={() => show(matches, (at + 1) % matches.length)} />
            <IconButton icon={X} label="Close search" size={14} onClick={() => { setSearching(false); termRef.current?.clearSelection() }} />
          </>
        ) : (
          <IconButton icon={Search} label="Search this log" size={14} onClick={() => setSearching(true)} />
        )}
      </div>
      <div ref={host} className="selectable min-h-0 w-full flex-1 overflow-hidden" aria-label="Script output" role="log" />
    </div>
  )
}
