/**
 * Works out which port a dev script is about to use, from what its command
 * line says, so Cairix can warn *before* "address already in use" instead of
 * after. Deliberately conservative: when it cannot tell, it says nothing.
 */

export interface PredictedPort {
  port: number
  /** How we know, for display: "--port 3000", "PORT in .env", "Next.js default". */
  why: string
}

const valid = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= 65535

/** Defaults of common dev servers. The first matching rule wins, so specific ones come first. */
const DEFAULTS: Array<{ re: RegExp; port: number; label: string }> = [
  { re: /\bvite\s+preview\b/, port: 4173, label: 'Vite preview' },
  { re: /\bvite(\s+(dev|serve))?(\s|$)/, port: 5173, label: 'Vite' },
  { re: /\bnext\s+(dev|start)\b|\bnext$/, port: 3000, label: 'Next.js' },
  { re: /\bnuxi?\s+(dev|preview)\b/, port: 3000, label: 'Nuxt' },
  { re: /\bastro\s+(dev|preview)\b/, port: 4321, label: 'Astro' },
  { re: /\bremix(-serve|\s+dev)\b/, port: 3000, label: 'Remix' },
  { re: /\breact-scripts\s+start\b/, port: 3000, label: 'Create React App' },
  { re: /\b(webpack\s+serve|webpack-dev-server)\b/, port: 8080, label: 'webpack dev server' },
  { re: /\bvue-cli-service\s+serve\b/, port: 8080, label: 'Vue CLI' },
  { re: /\bng\s+serve\b/, port: 4200, label: 'Angular' },
  { re: /\bstorybook\s+(dev|start)\b|\bstart-storybook\b/, port: 6006, label: 'Storybook' },
  { re: /\bexpo\s+start\b/, port: 8081, label: 'Expo' },
  { re: /\bgatsby\s+develop\b/, port: 8000, label: 'Gatsby' },
  { re: /\bdocusaurus\s+start\b/, port: 3000, label: 'Docusaurus' },
  { re: /\bjson-server\b/, port: 3000, label: 'json-server' },
  { re: /\bhugo\s+server\b/, port: 1313, label: 'Hugo' },
  { re: /\bjekyll\s+serve\b/, port: 4000, label: 'Jekyll' },
  { re: /manage\.py\s+runserver\b/, port: 8000, label: 'Django' },
  { re: /\bflask\s+run\b|\bflask\b.*\brun\b/, port: 5000, label: 'Flask' },
  { re: /\buvicorn\b/, port: 8000, label: 'Uvicorn' },
  { re: /\bgunicorn\b/, port: 8000, label: 'Gunicorn' },
  { re: /\brails\s+(s|server)\b/, port: 3000, label: 'Rails' },
  { re: /\bstreamlit\s+run\b/, port: 8501, label: 'Streamlit' },
  { re: /\bjupyter(\s+(lab|notebook))?\b/, port: 8888, label: 'Jupyter' }
]

/** `--port 3000`, `--port=3000`, `-p 3000` (the short form only for tools that mean a port by it). */
function explicit(text: string, shortOk: boolean): PredictedPort | undefined {
  const long = text.match(/(?:^|\s)--port(?:=|\s+)(\d{2,5})(?=\s|$)/)
  if (long && valid(+long[1])) return { port: +long[1], why: `--port ${long[1]}` }
  if (shortOk) {
    const short = text.match(/(?:^|\s)-p(?:=|\s+)?(\d{2,5})(?=\s|$)/)
    if (short && valid(+short[1])) return { port: +short[1], why: `-p ${short[1]}` }
  }
  // Django / http.server / bind forms: `runserver 0.0.0.0:8000`, `--bind :5000`, `-b 127.0.0.1:5000`, `http.server 8000`.
  const bind = text.match(/(?:runserver|--bind|-b|--listen|--host|--address)(?:=|\s+)[\w.[\]:*-]*:(\d{2,5})(?=\s|$)/)
  if (bind && valid(+bind[1])) return { port: +bind[1], why: `:${bind[1]}` }
  const http = text.match(/http\.server(?:\s+(?:--bind\s+\S+\s+)?)(\d{2,5})(?=\s|$)/)
  if (http && valid(+http[1])) return { port: +http[1], why: `http.server ${http[1]}` }
  return undefined
}

/**
 * @param command the script's command (and any extra arguments, space-joined)
 * @param env     environment the script will get (saved overrides, a project .env PORT)
 */
export function predictPorts(command: string, env: Record<string, string> = {}, envSource = 'PORT in your environment'): PredictedPort[] {
  const text = command.trim()
  if (!text) return []
  const framework = DEFAULTS.find((d) => d.re.test(text))
  const found = explicit(text, !!framework)
  if (found) return [found]
  // `PORT=4000 node server.js` written inside the command itself.
  const inline = text.match(/(?:^|\s)PORT=(\d{2,5})(?=\s|$)/)
  if (inline && valid(+inline[1])) return [{ port: +inline[1], why: `PORT=${inline[1]}` }]
  // Only guess from the environment for things that look like servers: a build script with PORT set is not one.
  if (framework && env.PORT && /^\d{2,5}$/.test(env.PORT) && valid(+env.PORT)) return [{ port: +env.PORT, why: envSource }]
  return framework ? [{ port: framework.port, why: `${framework.label} default` }] : []
}
