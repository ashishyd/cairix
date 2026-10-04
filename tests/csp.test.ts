import { describe, expect, it } from 'vitest'
import { contentSecurityPolicy } from '../src/shared/csp'

describe('contentSecurityPolicy', () => {
  const prod = contentSecurityPolicy(false)
  const dev = contentSecurityPolicy(true)

  it('production is strict: no inline script, no remote origins, no plugins', () => {
    expect(prod).toContain("script-src 'self'")
    expect(prod).not.toMatch(/script-src[^;]*unsafe-/)
    expect(prod).toContain("default-src 'self'")
    expect(prod).toContain("object-src 'none'")
    expect(prod).not.toMatch(/https?:|ws:/)
  })

  it('production (delivered via <meta>) omits directives browsers ignore there', () => {
    // Chromium logs a console error for each of these in a meta tag.
    for (const d of ['frame-ancestors', 'report-uri', 'sandbox']) expect(prod).not.toContain(d)
  })

  it('dev allows only what Vite needs: inline preamble and a local websocket', () => {
    expect(dev).toContain("script-src 'self' 'unsafe-inline'")
    expect(dev).toContain('ws://localhost:*')
    expect(dev).toContain("frame-ancestors 'none'") // fine as a header
    expect(dev).not.toMatch(/https:\/\//)
  })
})
