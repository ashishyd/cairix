import { execFile } from 'child_process'
import { z } from 'zod'
import type { WifiBand, WifiLink, WifiSpeed, WifiTip } from '@shared/types'

const network = z.object({
  spairport_network_channel: z.string().optional(),
  spairport_network_phymode: z.string().optional(),
  spairport_network_rate: z.number().optional(),
  spairport_signal_noise: z.string().optional()
})
const airport = z.object({
  SPAirPortDataType: z.array(
    z.object({
      spairport_airport_interfaces: z
        .array(
          z.object({
            _name: z.string(),
            spairport_status_information: z.string().optional(),
            spairport_current_network_information: network.optional(),
            spairport_airport_other_local_wireless_networks: z.array(network).optional()
          })
        )
        .optional()
    })
  )
})

/** "36 (5GHz, 160MHz)" → channel, band and width. */
export function parseChannel(text: string | undefined): { channel: number; band: WifiBand; widthMhz?: number } | undefined {
  const m = /^(\d+)\s*\((2|5|6)GHz(?:,\s*(\d+)MHz)?\)/.exec(text ?? '')
  if (!m) return undefined
  const band: WifiBand = m[2] === '2' ? '2.4 GHz' : m[2] === '5' ? '5 GHz' : '6 GHz'
  return { channel: Number(m[1]), band, widthMhz: m[3] ? Number(m[3]) : undefined }
}

/** Parses `system_profiler SPAirPortDataType -json`. Returns undefined when the Mac has no Wi-Fi card. */
export function parseAirport(json: string): WifiLink | undefined {
  const parsed = airport.safeParse(JSON.parse(json) as unknown)
  if (!parsed.success) throw new Error('macOS returned Wi-Fi details in a shape Cairix does not understand.')
  // en0 and friends; awdl0/llw0 are AirDrop links, not the Wi-Fi connection.
  const iface = parsed.data.SPAirPortDataType.flatMap((d) => d.spairport_airport_interfaces ?? []).find((i) => /^en\d+$/.test(i._name))
  if (!iface) return undefined
  const cur = iface.spairport_current_network_information
  const ch = parseChannel(cur?.spairport_network_channel)
  const sn = /(-?\d+)\s*dBm\s*\/\s*(-?\d+)\s*dBm/.exec(cur?.spairport_signal_noise ?? '')
  const nearby = (iface.spairport_airport_other_local_wireless_networks ?? []).flatMap((n) => {
    const c = parseChannel(n.spairport_network_channel)
    return c ? [{ band: c.band, channel: c.channel }] : []
  })
  return {
    connected: iface.spairport_status_information === 'spairport_status_connected' && !!ch,
    interface: iface._name,
    phyMode: cur?.spairport_network_phymode,
    channel: ch?.channel,
    band: ch?.band,
    widthMhz: ch?.widthMhz,
    rssi: sn ? Number(sn[1]) : undefined,
    noise: sn ? Number(sn[2]) : undefined,
    txRate: cur?.spairport_network_rate,
    nearby
  }
}

const quality = z.object({
  dl_throughput: z.number(),
  ul_throughput: z.number(),
  responsiveness: z.number(),
  base_rtt: z.number(),
  interface_name: z.string().default('')
})

/** Parses `networkQuality -c`. Throughputs arrive in bit/s. */
export function parseSpeed(json: string, at: number): WifiSpeed {
  const parsed = quality.safeParse(JSON.parse(json) as unknown)
  if (!parsed.success) throw new Error('The speed test finished without a result. Check the connection and try again.')
  const q = parsed.data
  const mbps = (bits: number): number => Math.round(bits / 1e5) / 10
  return { at, downMbps: mbps(q.dl_throughput), upMbps: mbps(q.ul_throughput), rpm: Math.round(q.responsiveness), idleMs: Math.round(q.base_rtt), interface: q.interface_name }
}

/**
 * Turns readings into a short list of things to try, worst first.
 * shortcut: thresholds are common rules of thumb (-67 dBm for video calls, 25 dB SNR), not tuned per router; revisit if users report wrong advice.
 */
export function adviseWifi(link: WifiLink | undefined, speed?: WifiSpeed): WifiTip[] {
  const tips: WifiTip[] = []
  if (!link) return [{ tone: 'danger', title: 'This Mac has no Wi-Fi', detail: 'No Wi-Fi interface was found. If you use Ethernet, Wi-Fi tips do not apply.' }]
  if (!link.connected) return [{ tone: 'danger', title: 'Wi-Fi is not connected', detail: 'Join a network from the Wi-Fi menu, then check again.' }]

  if (link.rssi !== undefined) {
    if (link.rssi < -75) tips.push({ tone: 'danger', title: `Weak signal (${link.rssi} dBm)`, detail: 'Move closer to the router, put it in the open and up high, or add a mesh point or access point near where you work.' })
    else if (link.rssi < -67) tips.push({ tone: 'warning', title: `Fair signal (${link.rssi} dBm)`, detail: 'Good enough for browsing, but calls and big downloads suffer. A room closer to the router, or fewer walls between you, helps most.' })
  }
  if (link.rssi !== undefined && link.noise !== undefined && link.rssi - link.noise < 25) {
    tips.push({ tone: 'warning', title: `Noisy air (${link.rssi - link.noise} dB above noise)`, detail: 'Something nearby is interfering: microwaves, Bluetooth hubs, USB 3 docks or cables close to the Mac. Move them away or move the router.' })
  }
  if (link.band === '2.4 GHz') {
    tips.push({ tone: 'warning', title: 'Connected on 2.4 GHz', detail: '2.4 GHz is slow and crowded. If your router has a 5 GHz or 6 GHz network, join it, or give the bands different names so the Mac stops picking 2.4 GHz.' })
    if (link.channel !== undefined && ![1, 6, 11].includes(link.channel)) {
      tips.push({ tone: 'warning', title: `Channel ${link.channel} overlaps its neighbours`, detail: 'On 2.4 GHz only channels 1, 6 and 11 do not overlap. Set the router to one of them.' })
    }
  }
  if (link.channel !== undefined) {
    const same = link.nearby.filter((n) => n.band === link.band && n.channel === link.channel).length
    if (same >= 3) {
      const options = link.band === '2.4 GHz' ? [1, 6, 11] : [...new Set(link.nearby.filter((n) => n.band === link.band).map((n) => n.channel))]
      const quietest = options.map((c) => ({ c, n: link.nearby.filter((x) => x.band === link.band && x.channel === c).length })).sort((a, b) => a.n - b.n)[0]
      const hint = quietest && quietest.c !== link.channel && link.band === '2.4 GHz' ? ` Channel ${quietest.c} is the quietest nearby.` : ' Try another channel, or let the router pick one automatically.'
      tips.push({ tone: 'warning', title: `${same} other networks share channel ${link.channel}`, detail: `They take turns with yours, so everyone slows down.${hint} Some of these may be your own mesh points, which is fine.` })
    }
  }
  if (link.phyMode && !/ac|ax|be/.test(link.phyMode)) {
    tips.push({ tone: 'warning', title: `Old Wi-Fi standard (${link.phyMode})`, detail: 'The link is using Wi-Fi 4 or older. A Wi-Fi 6 (802.11ax) router is several times faster at the same distance.' })
  }

  if (speed) {
    const vpn = /^utun\d+$/.test(speed.interface)
    if (vpn) tips.push({ tone: 'warning', title: 'Traffic goes through a VPN', detail: `The test used ${speed.interface}, a VPN tunnel. VPNs add delay and cap speed; pause it and test again to compare.` })
    if (speed.downMbps < 25) tips.push({ tone: 'danger', title: `Slow download (${speed.downMbps} Mbit/s)`, detail: 'Below what video calls and large installs need. Fix the Wi-Fi items above first; if there are none, the internet plan or the router is the limit.' })
    if (speed.rpm < 300) tips.push({ tone: 'warning', title: 'Lag under load', detail: `Only ${speed.rpm} round trips a minute while busy, so calls stutter when something downloads. Turn on SQM or "Smart Queue" in the router if it has it.` })
    if (!vpn && speed.idleMs > 100) tips.push({ tone: 'warning', title: `High delay (${speed.idleMs} ms)`, detail: 'Even an idle round trip is slow. This is usually the internet provider, not Wi-Fi.' })
    if (!vpn && link.txRate && speed.downMbps < link.txRate * 0.25 && (link.rssi ?? 0) >= -67) {
      tips.push({ tone: 'warning', title: 'Wi-Fi is not the bottleneck', detail: `The Wi-Fi link runs at ${link.txRate} Mbit/s but the internet gave ${speed.downMbps}. The limit is the internet plan, the router or the provider.` })
    }
  }
  if (tips.length === 0) tips.push({ tone: 'success', title: 'Wi-Fi looks healthy', detail: speed ? 'Strong signal, a clear band and good speed. Nothing to change.' : 'Strong signal and a clear band. Run a speed test to check the internet side.' })
  return tips.sort((a, b) => Number(b.tone === 'danger') - Number(a.tone === 'danger'))
}

export function runTool(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(new Error((stderr || err.message).trim().split('\n').slice(-1)[0].slice(0, 300)), { code: (err as NodeJS.ErrnoException).code }))
      else resolve(stdout)
    })
  })
}
