/**
 * Splits "--port 4000 --name 'my app'" into argv. Understands single and
 * double quotes; no shell expansion, because args are passed without a shell.
 */
export function parseArgs(input: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  for (let m = re.exec(input); m; m = re.exec(input)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** "KEY=value" lines to a map. Blank lines and `#` comments are skipped; a line without `=` is an error. */
export function parseEnvLines(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) throw new Error(`Line ${i + 1} should look like KEY=value.`)
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '')
    let value = line.slice(eq + 1).trim()
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) value = value.slice(1, -1)
    env[key] = value
  }
  return env
}

export function formatEnvLines(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n')
}
