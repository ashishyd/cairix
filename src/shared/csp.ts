/**
 * Content-Security-Policy for the renderer.
 *
 * Dev serves the page over http, so the policy is sent as a response header:
 * it needs inline script for the React refresh preamble and a websocket for
 * HMR. Production loads from file://, which has no headers, so the same policy
 * ships in a <meta> tag, and a few directives are not allowed there.
 * `frame-ancestors` is one of them (browsers ignore it and log a warning), and
 * it's pointless anyway: the page is a top-level window, never embedded.
 */
export function contentSecurityPolicy(dev: boolean): string {
  const script = dev ? "'self' 'unsafe-inline'" : "'self'"
  const connect = dev ? "'self' ws://localhost:* http://localhost:*" : "'self'"
  const directives = [
    "default-src 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "object-src 'none'",
    "base-uri 'none'"
  ]
  if (dev) directives.push("frame-ancestors 'none'") // header-only directive
  return directives.join('; ')
}
