/**
 * Redacts credentials from a process command line before it is shown or logged.
 *
 * Process arguments are readable by every program on the machine and many tools
 * take secrets that way (`--api-key sk-…`, `TOKEN=…`, `https://user:pass@host`).
 * Cairix lists other processes' command lines, so it must never become the
 * place where those get displayed. Matching is deliberately aggressive:
 * hiding a harmless value is a cosmetic loss, showing a secret is not.
 */

const MASK = '•••'

/** Flag names that carry a secret: --api-key, --token, --client-secret, --password ... */
const SECRET_FLAG =
  '--?[A-Za-z0-9_-]*(?:api[-_]?key|apikey|token|secret|passw(?:or)?d|passwd|pwd|auth|credential|private[-_]?key|access[-_]?key|bearer)[A-Za-z0-9_-]*'

// `--api-key=VALUE` (always a value), quoted or bare.
const FLAG_EQUALS = new RegExp(`(${SECRET_FLAG})=("[^"]*"|'[^']*'|\\S+)`, 'gi')

// `--api-key VALUE`: only when the next word isn't another flag, so `--no-auth --verbose` keeps `--verbose`.
const FLAG_SPACE = new RegExp(`(${SECRET_FLAG})\\s+("[^"]*"|'[^']*'|[^\\s-]\\S*)`, 'gi')

// `OPENAI_API_KEY=abc` style assignments inside a command line.
const ENV_ASSIGN = /\b([A-Za-z][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIALS?))=("[^"]*"|'[^']*'|\S+)/g

// `scheme://user:password@host`
// Anchored (no match may start mid-word) and bounded: an unbounded `\w+` here was quadratic on long
// unbroken runs such as minified code, taking seconds for a 30 KB line.
const URL_CREDENTIALS = /(?<!\w)(\w{1,20}:\/\/[^/\s:@]{1,100}):([^@\s/]{1,200})@/g

// Well-known token shapes, wherever they appear.
const TOKEN_SHAPES = new RegExp(
  [
    'sk-[A-Za-z0-9_-]{16,}', // OpenAI / Anthropic style
    'gh[pousr]_[A-Za-z0-9]{20,}', // GitHub
    'github_pat_[A-Za-z0-9_]{20,}',
    'xox[abprs]-[A-Za-z0-9-]{10,}', // Slack
    'AKIA[0-9A-Z]{16}', // AWS access key id
    'AIza[0-9A-Za-z_-]{30,}', // Google API key
    'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}' // JWT
  ].join('|'),
  'g'
)

export function redactCommand(command: string): string {
  return command
    .replace(FLAG_EQUALS, `$1=${MASK}`)
    .replace(FLAG_SPACE, `$1 ${MASK}`)
    .replace(ENV_ASSIGN, `$1=${MASK}`)
    .replace(URL_CREDENTIALS, `$1:${MASK}@`)
    .replace(TOKEN_SHAPES, MASK)
}

/** True if the text contains a well-known credential shape (API key, PAT, JWT...). Used to flag secrets in code. */
export function hasTokenShape(text: string): boolean {
  TOKEN_SHAPES.lastIndex = 0
  const found = TOKEN_SHAPES.test(text)
  TOKEN_SHAPES.lastIndex = 0
  return found
}

/** Masks credential shapes and URL passwords but leaves ordinary code intact. For text sent to an AI. */
export function redactTokens(text: string): string {
  return text.replace(URL_CREDENTIALS, `$1:${MASK}@`).replace(TOKEN_SHAPES, MASK)
}
