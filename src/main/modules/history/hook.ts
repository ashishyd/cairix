import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { shq } from '../../terminal'
import type { ParsedCommand } from './parse'

/**
 * zsh does not record where a command ran, so folder context needs a hook.
 * Cairix never edits your dotfiles silently: this is only done when the user
 * agrees, it adds one clearly marked block, backs the file up once, and can be
 * undone from the same screen.
 */

export const BLOCK_START = '# >>> cairix command folders >>>'
export const BLOCK_END = '# <<< cairix command folders <<<'

/** The zsh code that appends `time<TAB>folder<TAB>command` to Cairix's log before each command runs. */
export function hookScript(logPath: string): string {
  return `# Cairix: records the folder each command runs in, for the Commands page.
# Remove the "cairix command folders" block from your .zshrc (Cairix can do this) to stop.
zmodload zsh/datetime 2>/dev/null
typeset -g _CAIRIX_LOG=${shq(logPath)}
_cairix_preexec() {
  [[ -z $1 || $1 == ' '* ]] && return   # a leading space means "do not remember this"
  local cmd=\${1//$'\\n'/ }
  cmd=\${cmd//$'\\t'/ }
  print -r -- "\${EPOCHSECONDS:-0}"$'\\t'"\${PWD:A}"$'\\t'"$cmd" >> "$_CAIRIX_LOG" 2>/dev/null
}
autoload -Uz add-zsh-hook 2>/dev/null && add-zsh-hook preexec _cairix_preexec
`
}

/** The block added to .zshrc. Shown to the user before it is written. */
export function rcBlock(hookPath: string): string {
  return `${BLOCK_START}\n[ -f ${shq(hookPath)} ] && source ${shq(hookPath)}\n${BLOCK_END}\n`
}

export function hasBlock(rcText: string): boolean {
  return rcText.includes(BLOCK_START) && rcText.includes(BLOCK_END)
}

/** Removes our block (and nothing else). */
export function stripBlock(rcText: string): string {
  const start = rcText.indexOf(BLOCK_START)
  const endAt = rcText.indexOf(BLOCK_END)
  if (start < 0 || endAt < start) return rcText
  let end = endAt + BLOCK_END.length
  if (rcText[end] === '\n') end++
  const before = rcText.slice(0, start).replace(/\n{2,}$/, '\n')
  return before + rcText.slice(end)
}

export function addBlock(rcText: string, hookPath: string): string {
  const base = stripBlock(rcText)
  const sep = base === '' || base.endsWith('\n') ? '' : '\n'
  return `${base}${sep}${base === '' ? '' : '\n'}${rcBlock(hookPath)}`
}

export interface HookPaths {
  rcFile: string
  hookPath: string
  logPath: string
}

export function readRc(rcFile: string): string {
  try {
    return readFileSync(rcFile, 'utf8')
  } catch {
    return ''
  }
}

export function installHook(p: HookPaths): void {
  mkdirSync(dirname(p.hookPath), { recursive: true })
  writeFileSync(p.hookPath, hookScript(p.logPath), 'utf8')
  const rc = readRc(p.rcFile)
  const backup = `${p.rcFile}.cairix-backup`
  if (rc !== '' && !existsSync(backup)) writeFileSync(backup, rc, 'utf8')
  writeFileSync(p.rcFile, addBlock(rc, p.hookPath), 'utf8')
}

export function removeHook(p: HookPaths): void {
  const rc = readRc(p.rcFile)
  if (hasBlock(rc)) writeFileSync(p.rcFile, stripBlock(rc), 'utf8')
}

/** One line of the hook's log. */
export interface HookEntry extends ParsedCommand {
  cwd: string
}

/** Parses `time<TAB>folder<TAB>command` lines; anything malformed is skipped. */
export function parseHookLog(text: string): HookEntry[] {
  const out: HookEntry[] = []
  for (const line of text.split('\n')) {
    const a = line.indexOf('\t')
    const b = a < 0 ? -1 : line.indexOf('\t', a + 1)
    if (b < 0) continue
    const ts = Number.parseInt(line.slice(0, a), 10)
    const cwd = line.slice(a + 1, b)
    const command = line.slice(b + 1)
    if (!cwd.startsWith('/') || cwd.includes('\0') || command.trim() === '') continue
    out.push({ command, cwd, ts: Number.isFinite(ts) && ts > 0 ? ts : undefined })
  }
  return out
}

