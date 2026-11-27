import type { WifiBand, WifiLink } from './types'

export interface ChannelLoad {
  channel: number
  /** Other networks heard on exactly this channel. Overlap between neighbouring 2.4 GHz channels is not counted. */
  others: number
  /** Your own network is on this channel. */
  mine: boolean
}

const CHANNELS: Record<WifiBand, number[] | null> = {
  '2.4 GHz': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  '5 GHz': [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
  // 6 GHz has too many channels to list; only ones in use are shown.
  '6 GHz': null
}

/** Channels of one band with how many other networks share each, in channel order. */
export function channelLoads(link: Pick<WifiLink, 'band' | 'channel' | 'nearby'>, band: WifiBand): ChannelLoad[] {
  const count = new Map<number, number>()
  for (const n of link.nearby) if (n.band === band) count.set(n.channel, (count.get(n.channel) ?? 0) + 1)
  const mine = link.band === band ? link.channel : undefined
  const base = CHANNELS[band] ?? []
  const all = new Set([...base, ...count.keys(), ...(mine !== undefined ? [mine] : [])])
  return [...all].sort((a, b) => a - b).map((channel) => ({ channel, others: count.get(channel) ?? 0, mine: channel === mine }))
}

/** The emptiest channels (other than yours), emptiest first. Empty when yours is already among the emptiest. */
export function quietChannels(loads: ChannelLoad[], limit = 3): number[] {
  const mine = loads.find((l) => l.mine)
  const best = [...loads].filter((l) => !l.mine).sort((a, b) => a.others - b.others || a.channel - b.channel)
  if (mine && best.length > 0 && best[0].others >= mine.others) return []
  return best.slice(0, limit).filter((l) => !mine || l.others < mine.others).map((l) => l.channel)
}
