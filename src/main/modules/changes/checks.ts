import { createHash } from 'crypto'
import { hasTokenShape } from '@shared/redact'
import type { Finding, Severity } from '@shared/types'
import type { DiffFile } from './diff'
import { learnFor } from './learn'

/**
 * Instant, free, deterministic checks over the lines you just added. They run
 * every time the diff changes, with no AI call, and cover the mistakes that
 * are most common and most costly to ship: leaked secrets, leftover debug
 * code, committed conflict markers, focused tests, risky patterns.
 */

const JS = /\.(?:[cm]?[jt]sx?)$/
const PY = /\.py$/
const TEST_FILE = /(?:^|\/)(?:__tests__|tests?|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/
const COMMENT = /^\s*(?:\/\/|#|\*|\/\*|<!--)/

interface Rule {
  id: string
  severity: Severity
  category: string
  title: string
  explanation: string
  topic: string
  /** Which files the rule applies to. */
  appliesTo(path: string): boolean
  match(text: string): boolean
  /** Skip comment lines for this rule. Secrets and conflict markers still fire in comments. */
  skipComments?: boolean
  /** Instant fix: how to rewrite or remove the line. */
  fix?(text: string): { kind: 'delete' } | { kind: 'replace'; text: string } | null
}

const PLACEHOLDER = /process\.env|import\.meta\.env|os\.environ|getenv|your[_-]|example|changeme|placeholder|xxxx|<[^>]+>|\$\{/i
const SECRET_ASSIGN = /\b(?:api[_-]?key|secret|token|passw(?:or)?d|private[_-]?key|client[_-]?secret|auth[_-]?token)\w*\s*[:=]\s*["'`]([^\s"'`]{12,})["'`]/i
// A long value that is really a URL or a file path is not a credential.
const NOT_A_VALUE = /^(?:https?:|\/|\.\.?\/|[a-z]+:\/\/)/i

const RULES: Rule[] = [
  {
    id: 'secret-token',
    severity: 'error',
    category: 'security',
    title: 'A credential looks like it is hard-coded here',
    explanation: 'Keys committed to git stay in history even after you delete them, and anyone with repo access can use them. Move it to an environment variable, rotate the key, and keep the real value out of the repository.',
    topic: 'secrets',
    appliesTo: () => true,
    match: (t) => hasTokenShape(t) || looksLikeSecretAssignment(t)
  },
  {
    id: 'conflict-marker',
    severity: 'error',
    category: 'bug',
    title: 'Unresolved merge conflict marker',
    explanation: 'This file still contains git conflict markers (<<<<<<<, =======, >>>>>>>). It will not compile or run correctly until the conflict is resolved.',
    topic: 'merge-conflicts',
    appliesTo: () => true,
    match: (t) => /^(?:<{7}|>{7})(?:\s|$)/.test(t) || /^={7}$/.test(t)
  },
  {
    id: 'test-only',
    severity: 'error',
    category: 'bug',
    title: 'A focused test (.only) will silently skip the rest',
    explanation: '`.only` makes the runner execute just this test, so CI can pass while most of your suite never ran. Remove it before committing.',
    topic: 'test-only',
    appliesTo: (p) => JS.test(p),
    match: (t) => /\b(?:describe|it|test|context)\.only\s*\(/.test(t),
    skipComments: true,
    fix: (t) => ({ kind: 'replace', text: t.replace(/\.only(\s*\()/, '$1') })
  },
  {
    id: 'debugger',
    severity: 'warning',
    category: 'cleanup',
    title: 'Leftover debugger statement',
    explanation: 'A `debugger` statement pauses execution whenever dev tools are open, including in production for anyone who opens them. It is almost always a leftover from debugging.',
    topic: 'debugger',
    appliesTo: (p) => JS.test(p),
    match: (t) => /^\s*debugger\s*;?\s*$/.test(t),
    fix: () => ({ kind: 'delete' })
  },
  {
    id: 'eval',
    severity: 'warning',
    category: 'security',
    title: 'eval() runs arbitrary code',
    explanation: 'If any part of the string comes from a user, a file or the network, eval lets an attacker run their own code. There is almost always a safer way, such as JSON.parse, a lookup table, or a real parser.',
    topic: 'eval',
    appliesTo: (p) => JS.test(p),
    match: (t) => /(?<![\w.$])eval\s*\(/.test(t),
    skipComments: true
  },
  {
    id: 'regexp-dynamic',
    severity: 'warning',
    category: 'security',
    title: 'A RegExp is built from a variable',
    explanation: 'If the variable can contain user input, special characters change what the pattern means and a crafted string can make the matcher hang (ReDoS). Escape the input first, or avoid building patterns from it.',
    topic: 'redos',
    appliesTo: (p) => JS.test(p),
    match: (t) => /new RegExp\(\s*(?!["'`/])[A-Za-z_$][\w$.]*/.test(t) && !/escape/i.test(t),
    skipComments: true
  },
  {
    id: 'inner-html',
    severity: 'warning',
    category: 'security',
    title: 'Raw HTML is inserted into the page',
    explanation: 'innerHTML and dangerouslySetInnerHTML do not escape their input, so any untrusted text becomes a cross-site scripting hole. Prefer textContent or normal JSX, or sanitize the HTML first.',
    topic: 'xss',
    appliesTo: (p) => JS.test(p),
    match: (t) => /\.innerHTML\s*=|dangerouslySetInnerHTML/.test(t),
    skipComments: true
  },
  {
    id: 'console-log',
    severity: 'info',
    category: 'cleanup',
    title: 'console.log left in the code',
    explanation: 'Debug output tends to leak internal data into browser consoles and server logs. Remove it, or switch to a proper logger with levels.',
    topic: 'console',
    appliesTo: (p) => JS.test(p) && !TEST_FILE.test(p) && !/(?:^|\/)(?:scripts?|bin|cli)\//.test(p),
    match: (t) => /\bconsole\.(?:log|debug)\s*\(/.test(t),
    skipComments: true,
    fix: (t) => (/^\s*console\.(?:log|debug)\(.*\);?\s*$/.test(t) && balanced(t) ? { kind: 'delete' } : null)
  },
  {
    id: 'ts-any',
    severity: 'info',
    category: 'quality',
    title: 'The any type turns off type checking',
    explanation: 'Values typed `any` skip every compiler check, so mistakes surface at runtime instead. Prefer `unknown` and narrow it, or write the real type.',
    topic: 'ts-any',
    appliesTo: (p) => /\.tsx?$/.test(p),
    match: (t) => /(?::\s*any\b|\bas any\b|<any>)/.test(t),
    skipComments: true
  },
  {
    id: 'py-bare-except',
    severity: 'warning',
    category: 'bug',
    title: 'A bare except hides every error',
    explanation: '`except:` also catches KeyboardInterrupt and SystemExit and swallows real bugs silently. Catch the specific exception you expect, or at least `Exception`, and log it.',
    topic: 'py-except',
    appliesTo: (p) => PY.test(p),
    match: (t) => /^\s*except\s*:/.test(t)
  },
  {
    id: 'py-shell-true',
    severity: 'warning',
    category: 'security',
    title: 'subprocess with shell=True can run injected commands',
    explanation: 'With shell=True the command goes through the shell, so any user-controlled text in it can add its own commands. Pass the arguments as a list and leave shell off.',
    topic: 'py-subprocess',
    appliesTo: (p) => PY.test(p),
    match: (t) => /shell\s*=\s*True/.test(t),
    skipComments: true
  },
  {
    id: 'tls-off',
    severity: 'error',
    category: 'security',
    title: 'TLS certificate checking is turned off',
    explanation: 'Disabling certificate verification lets anyone on the network impersonate the server and read or change the traffic. Fix the certificate problem instead of switching the check off.',
    topic: 'tls-verify',
    appliesTo: (p) => JS.test(p) || PY.test(p),
    match: (t) => /verify\s*=\s*False|rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0/.test(t),
    skipComments: true
  }
]

function looksLikeSecretAssignment(t: string): boolean {
  const m = t.match(SECRET_ASSIGN)
  return !!m && !PLACEHOLDER.test(t) && !NOT_A_VALUE.test(m[1])
}

/** True when parentheses on the line balance, so deleting it can't orphan a multi-line call. */
function balanced(t: string): boolean {
  let d = 0
  for (const ch of t) {
    if (ch === '(') d++
    else if (ch === ')') d--
    if (d < 0) return false
  }
  return d === 0
}

const findingId = (file: string, rule: string, text: string): string =>
  createHash('sha1').update(`${file}|${rule}|${text.trim()}`).digest('hex').slice(0, 12)

export function runChecks(files: DiffFile[]): Finding[] {
  const out: Finding[] = []
  for (const f of files) {
    if (f.binary) continue
    if (/(?:^|\/)\.env(?:\.(?!example|sample|template|dist)[\w.-]+)?$/.test(f.path) && f.additions > 0) {
      out.push({
        id: findingId(f.path, 'env-file', ''),
        severity: 'error',
        category: 'security',
        file: f.path,
        title: 'An .env file is about to be committed',
        explanation: '.env files usually hold real secrets. Add it to .gitignore, remove it from the commit, and rotate anything it contained if it was ever pushed.',
        origin: 'check',
        learn: learnFor('secrets'),
        quickFix: false
      })
    }
    for (const added of f.added) {
      for (const rule of RULES) {
        if (!rule.appliesTo(f.path)) continue
        if (rule.skipComments && COMMENT.test(added.text)) continue
        if (!rule.match(added.text)) continue
        out.push({
          id: findingId(f.path, rule.id, added.text),
          severity: rule.severity,
          category: rule.category,
          file: f.path,
          line: added.line,
          title: rule.title,
          explanation: rule.explanation,
          origin: 'check',
          learn: learnFor(rule.topic),
          quickFix: !!rule.fix?.(added.text)
        })
        break // one finding per line is enough
      }
    }
  }
  return out
}

/** Builds the zero-context unified diff for a rule's instant fix, or null if there isn't one. */
export function quickFixPatch(file: string, line: number, text: string, ruleHint: Finding): string | null {
  const rule = RULES.find((r) => r.title === ruleHint.title)
  const fix = rule?.fix?.(text)
  if (!fix) return null
  const head = `--- a/${file}\n+++ b/${file}\n`
  if (fix.kind === 'delete') return `${head}@@ -${line},1 +${line - 1},0 @@\n-${text}\n`
  return `${head}@@ -${line},1 +${line},1 @@\n-${text}\n+${fix.text}\n`
}
