import type { LearnLink } from '@shared/types'

/**
 * Curated "learn why" links. The AI never invents URLs (models make up links
 * that 404): it can only pick a topic id from this list, and every URL must be
 * https on an allow-listed documentation site. Anything else is dropped.
 */

const SOURCES: Record<string, string> = {
  'owasp.org': 'OWASP',
  'cheatsheetseries.owasp.org': 'OWASP',
  'developer.mozilla.org': 'MDN',
  'react.dev': 'React',
  'git-scm.com': 'Git',
  'vitest.dev': 'Vitest',
  'docs.python.org': 'Python docs',
  'requests.readthedocs.io': 'Requests',
  'www.typescriptlang.org': 'TypeScript',
  'nextjs.org': 'Next.js',
  'web.dev': 'web.dev'
}

const T = (title: string, url: string): LearnLink => ({ title, url, source: SOURCES[new URL(url).hostname] ?? '' })

export const TOPICS: Record<string, LearnLink> = {
  secrets: T('Managing secrets safely', 'https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html'),
  redos: T('Regular expression denial of service (ReDoS)', 'https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS'),
  xss: T('Cross-site scripting (XSS)', 'https://owasp.org/www-community/attacks/xss/'),
  injection: T('Injection flaws', 'https://owasp.org/www-community/Injection_Flaws'),
  eval: T('Never use eval()', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/eval#never_use_direct_eval!'),
  console: T('The console API', 'https://developer.mozilla.org/en-US/docs/Web/API/console'),
  debugger: T('The debugger statement', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/debugger'),
  'merge-conflicts': T('Resolving merge conflicts', 'https://git-scm.com/book/en/v2/Git-Branching-Basic-Branching-and-Merging#_basic_merge_conflicts'),
  'test-only': T('Running a subset of tests (.only)', 'https://vitest.dev/api/#test-only'),
  'react-effects': T('Synchronizing with effects', 'https://react.dev/learn/synchronizing-with-effects'),
  'react-deps': T('Effect dependencies', 'https://react.dev/reference/react/useEffect#specifying-reactive-dependencies'),
  'react-keys': T('Keeping list items in order with key', 'https://react.dev/learn/rendering-lists#keeping-list-items-in-order-with-key'),
  'py-except': T('Handling exceptions', 'https://docs.python.org/3/tutorial/errors.html#handling-exceptions'),
  'py-subprocess': T('subprocess security considerations', 'https://docs.python.org/3/library/subprocess.html#security-considerations'),
  'tls-verify': T('SSL certificate verification', 'https://requests.readthedocs.io/en/latest/user/advanced/#ssl-cert-verification'),
  'ts-any': T('The any type', 'https://www.typescriptlang.org/docs/handbook/2/everyday-types.html#any'),
  async: T('Asynchronous JavaScript', 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Asynchronous'),
  a11y: T('Accessibility basics', 'https://web.dev/learn/accessibility')
}

export function isAllowedUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname in SOURCES
  } catch {
    return false
  }
}

export function learnFor(topicId: string | undefined): LearnLink | undefined {
  const link = topicId ? TOPICS[topicId] : undefined
  return link && isAllowedUrl(link.url) ? link : undefined
}

export const TOPIC_IDS = Object.keys(TOPICS)
