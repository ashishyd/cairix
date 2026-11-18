import { describe, expect, it } from 'vitest'
import type { WifiLink } from '../src/shared/types'
import { adviseWifi, parseAirport, parseChannel, parseSpeed } from '../src/main/modules/wifi/wifi'
import { WifiService } from '../src/main/modules/wifi/service'

const net = (channel: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ _name: '<redacted>', spairport_network_channel: channel, ...extra })
const profiler = (current: Record<string, unknown> | undefined, others: Array<Record<string, unknown>> = [], status = 'spairport_status_connected'): string =>
  JSON.stringify({
    SPAirPortDataType: [{
      spairport_airport_interfaces: [
        { _name: 'en0', spairport_status_information: status, spairport_current_network_information: current, spairport_airport_other_local_wireless_networks: others, spairport_wireless_mac_address: '9e:52:00:00:00:00' },
        { _name: 'awdl0', spairport_current_network_information: { spairport_network_type: 'spairport_network_type_station' } }
      ]
    }]
  })
const GOOD = net('36 (5GHz, 160MHz)', { spairport_network_phymode: '802.11ax', spairport_network_rate: 1361, spairport_signal_noise: '-55 dBm / -92 dBm' })
const quality = (o: Record<string, unknown> = {}): string => JSON.stringify({ dl_throughput: 28_777_764, ul_throughput: 27_267_974, responsiveness: 84.7, base_rtt: 193.2, interface_name: 'utun4', il_tls_handshake: [228, 224], ...o })

const link = (o: Partial<WifiLink> = {}): WifiLink => ({ connected: true, interface: 'en0', phyMode: '802.11ax', channel: 36, band: '5 GHz', widthMhz: 80, rssi: -50, noise: -92, txRate: 1200, nearby: [], ...o })
const titles = (l: WifiLink | undefined, s?: Parameters<typeof adviseWifi>[1]): string[] => adviseWifi(l, s).map((t) => t.title)

describe('parsing macOS Wi-Fi output', () => {
  it('reads channel, band and width', () => {
    expect(parseChannel('36 (5GHz, 160MHz)')).toEqual({ channel: 36, band: '5 GHz', widthMhz: 160 })
    expect(parseChannel('6 (2GHz, 20MHz)')).toMatchObject({ channel: 6, band: '2.4 GHz' })
    expect(parseChannel('37 (6GHz)')).toEqual({ channel: 37, band: '6 GHz', widthMhz: undefined })
    expect(parseChannel('weird')).toBeUndefined()
  })
  it('reads the en0 link, skips AirDrop links, and keeps no network names or MAC address', () => {
    const l = parseAirport(profiler(GOOD, [net('6 (2GHz, 20MHz)'), net('108 (5GHz, 80MHz)'), net('nonsense')]))
    expect(l).toEqual({ connected: true, interface: 'en0', phyMode: '802.11ax', channel: 36, band: '5 GHz', widthMhz: 160, rssi: -55, noise: -92, txRate: 1361, nearby: [{ band: '2.4 GHz', channel: 6 }, { band: '5 GHz', channel: 108 }] })
    expect(JSON.stringify(l)).not.toMatch(/redacted|9e:52/)
  })
  it('reports disconnected and missing Wi-Fi, and rejects foreign shapes', () => {
    expect(parseAirport(profiler(undefined, [], 'spairport_status_off'))?.connected).toBe(false)
    expect(parseAirport(JSON.stringify({ SPAirPortDataType: [{}] }))).toBeUndefined()
    expect(() => parseAirport(JSON.stringify({ nope: 1 }))).toThrow(/does not understand/)
  })
  it('converts networkQuality bit/s into Mbit/s', () => {
    expect(parseSpeed(quality(), 5)).toEqual({ at: 5, downMbps: 28.8, upMbps: 27.3, rpm: 85, idleMs: 193, interface: 'utun4' })
    expect(() => parseSpeed('{}', 5)).toThrow(/without a result/)
  })
})

describe('Wi-Fi advice', () => {
  it('says healthy when nothing is wrong', () => {
    expect(adviseWifi(link())).toEqual([expect.objectContaining({ tone: 'success', title: 'Wi-Fi looks healthy' })])
  })
  it('grades signal and noise', () => {
    expect(titles(link({ rssi: -70 }))[0]).toMatch(/Fair signal/)
    expect(adviseWifi(link({ rssi: -80 }))[0]).toMatchObject({ tone: 'danger', title: 'Weak signal (-80 dBm)' })
    expect(titles(link({ rssi: -60, noise: -80 }))).toContain('Noisy air (20 dB above noise)')
  })
  it('flags 2.4 GHz, overlapping channels and the quietest of 1, 6, 11', () => {
    const nearby = [6, 6, 6, 11, 1, 1].map((channel) => ({ band: '2.4 GHz' as const, channel }))
    const tips = adviseWifi(link({ band: '2.4 GHz', channel: 6, nearby }))
    expect(tips.map((t) => t.title)).toEqual(expect.arrayContaining(['Connected on 2.4 GHz', '3 other networks share channel 6']))
    expect(tips.find((t) => t.title.startsWith('3 other'))?.detail).toMatch(/Channel 11 is the quietest/)
    expect(titles(link({ band: '2.4 GHz', channel: 3 }))).toContain('Channel 3 overlaps its neighbours')
  })
  it('flags an old standard', () => {
    expect(titles(link({ phyMode: '802.11n' }))).toContain('Old Wi-Fi standard (802.11n)')
  })
  it('reads the speed test: VPN, slow, lag, delay, and when Wi-Fi is not the bottleneck', () => {
    const s = { at: 1, downMbps: 20, upMbps: 5, rpm: 100, idleMs: 190, interface: 'utun4' }
    expect(titles(link(), s)).toEqual(['Slow download (20 Mbit/s)', 'Traffic goes through a VPN', 'Lag under load'])
    expect(titles(link(), { ...s, interface: 'en0', downMbps: 100, rpm: 900 })).toEqual(['High delay (190 ms)', 'Wi-Fi is not the bottleneck'])
    expect(titles(link(), { ...s, interface: 'en0', downMbps: 900, rpm: 900, idleMs: 20 })).toEqual(['Wi-Fi looks healthy'])
  })
  it('handles no Wi-Fi and no connection', () => {
    expect(titles(undefined)).toEqual(['This Mac has no Wi-Fi'])
    expect(titles(link({ connected: false }))).toEqual(['Wi-Fi is not connected'])
  })
})

describe('the Wi-Fi service', () => {
  function fake(fail?: Error) {
    const calls: Array<[string, string[]]> = []
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const svc = new WifiService({
      now: () => 42,
      run: async (bin, args) => {
        calls.push([bin, args])
        if (bin.endsWith('networkQuality')) {
          await gate
          if (fail) throw fail
          return quality()
        }
        return profiler(GOOD)
      }
    })
    return { svc, calls, release }
  }

  it('reads status with absolute tool paths and fixed arguments', async () => {
    const f = fake()
    const s = await f.svc.status()
    expect(s).toMatchObject({ at: 42, available: true, speed: undefined, link: { channel: 36 } })
    expect(f.calls).toEqual([['/usr/sbin/system_profiler', ['SPAirPortDataType', '-json']]])
  })
  it('runs one speed test at a time and keeps the result for later status calls', async () => {
    const f = fake()
    const a = f.svc.speedTest()
    const b = f.svc.speedTest()
    f.release()
    const [ra, rb] = await Promise.all([a, b])
    expect(ra).toBe(rb)
    expect(f.calls.filter(([bin]) => bin === '/usr/bin/networkQuality')).toEqual([['/usr/bin/networkQuality', ['-c', '-M', '20']]])
    expect(ra.tips.map((t) => t.title)).toContain('Traffic goes through a VPN')
    expect((await f.svc.status()).speed?.downMbps).toBe(28.8)
  })
  it('explains failures in full sentences', async () => {
    const f = fake(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }))
    const p = f.svc.speedTest()
    f.release()
    await expect(p).rejects.toThrow('The speed test needs macOS 12 or newer.')
    const down = new WifiService({ run: async () => { throw new Error('boom') } })
    expect(await down.status()).toMatchObject({ available: false, reason: 'Could not read Wi-Fi details. boom', tips: [] })
  })
})
