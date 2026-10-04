import { describe, expect, it } from 'vitest'
import { parseBilling } from '../src/main/modules/agents/service'
import { formatCost } from '../src/shared/cost'

describe('billing detection', () => {
  it('claude.ai login is a subscription', () => {
    expect(parseBilling('{"loggedIn":true,"authMethod":"claude.ai"}')).toBe('subscription')
  })
  it('other auth methods are treated as metered', () => {
    expect(parseBilling('{"loggedIn":true,"authMethod":"api_key"}')).toBe('api')
  })
  it('logged out or unparseable is unknown', () => {
    expect(parseBilling('{"loggedIn":false}')).toBeUndefined()
    expect(parseBilling('nope')).toBeUndefined()
  })
  it('labels subscription cost as plan usage, not spend', () => {
    expect(formatCost(0.0241, true)).toBe('≈$0.024 of plan usage')
    expect(formatCost(0.0241, false)).toBe('$0.024')
  })
})
