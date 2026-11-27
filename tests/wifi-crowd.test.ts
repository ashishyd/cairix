import { describe, expect, it } from 'vitest'
import { channelLoads, quietChannels } from '../src/shared/wifi-crowd'

const link = { band: '5 GHz' as const, channel: 36, nearby: [{ band: '5 GHz' as const, channel: 36 }, { band: '5 GHz' as const, channel: 36 }, { band: '5 GHz' as const, channel: 149 }, { band: '2.4 GHz' as const, channel: 6 }] }

describe('channelLoads', () => {
  it('counts other networks per channel for one band and marks your own channel', () => {
    const loads = channelLoads(link, '5 GHz')
    expect(loads.find((l) => l.channel === 36)).toEqual({ channel: 36, others: 2, mine: true })
    expect(loads.find((l) => l.channel === 149)?.others).toBe(1)
    expect(loads.find((l) => l.channel === 52)?.others).toBe(0)
    expect(loads.some((l) => l.channel === 6)).toBe(false)
  })
  it('shows a channel in use even when it is not in the standard list', () => {
    expect(channelLoads({ nearby: [{ band: '6 GHz', channel: 37 }] }, '6 GHz')).toEqual([{ channel: 37, others: 1, mine: false }])
  })
})

describe('quietChannels', () => {
  it('suggests emptier channels than yours', () => expect(quietChannels(channelLoads(link, '5 GHz'))).toEqual([40, 44, 48]))
  it('suggests nothing when yours is already among the emptiest', () => {
    expect(quietChannels(channelLoads({ band: '5 GHz', channel: 36, nearby: [{ band: '5 GHz', channel: 149 }] }, '5 GHz'))).toEqual([])
  })
})
