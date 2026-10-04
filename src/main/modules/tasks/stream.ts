import { redactTokens } from '@shared/redact'
import type { TaskEvent } from '@shared/types'

/**
 * Turns the CLIs' `--output-format stream-json` lines into a short activity
 * feed. Claude Code emits one JSON object per line: `system` (setup noise,
 * ignored), `assistant` (text and tool calls), `user` (tool results, ignored)
 * and a final `result`. Cursor's agent uses the same shape. Anything that
 * isn't JSON is shown as plain text, so an unexpected format degrades to a
 * readable log instead of an empty screen.
 */

export interface Parsed {
  events: TaskEvent[]
  /** Set by the final `result` line. */
  final?: { text: string; isError: boolean; costUsd?: number }
}

const clip = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** One readable line for a tool call: "Read src/a.ts", "Grep \"TODO\"", "Bash npm test". */
export function describeTool(name: string, input: unknown): string {
  const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const detail = i.file_path ?? i.path ?? i.pattern ?? i.command ?? i.url ?? i.query ?? i.description
  return redactTokens(clip(detail === undefined ? name : `${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`))
}

export function parseStreamLine(line: string): Parsed {
  const trimmed = line.trim()
  if (!trimmed) return { events: [] }
  let obj: Record<string, unknown>
  try {
    const v = JSON.parse(trimmed)
    if (!v || typeof v !== 'object') return { events: [{ kind: 'text', text: redactTokens(clip(trimmed, 400)) }] }
    obj = v as Record<string, unknown>
  } catch {
    return { events: [{ kind: 'text', text: redactTokens(clip(trimmed, 400)) }] }
  }

  switch (obj.type) {
    case 'assistant': {
      const content = ((obj.message as { content?: unknown })?.content ?? []) as Array<Record<string, unknown>>
      const events: TaskEvent[] = []
      for (const c of Array.isArray(content) ? content : []) {
        if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) events.push({ kind: 'text', text: redactTokens(clip(c.text.trim(), 1500)) })
        else if (c.type === 'tool_use' && typeof c.name === 'string') events.push({ kind: 'tool', text: describeTool(c.name, c.input) })
      }
      return { events }
    }
    case 'result': {
      const text = typeof obj.result === 'string' ? obj.result : ''
      const isError = obj.is_error === true || (typeof obj.subtype === 'string' && obj.subtype.startsWith('error'))
      return { events: [], final: { text: redactTokens(text.slice(0, 50_000)), isError, costUsd: typeof obj.total_cost_usd === 'number' ? obj.total_cost_usd : undefined } }
    }
    case 'system':
    case 'user':
      return { events: [] } // hooks, init, tool output: noise for a feed
    default:
      return { events: [] }
  }
}
