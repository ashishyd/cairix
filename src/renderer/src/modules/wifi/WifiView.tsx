import { Gauge, RefreshCw, Wifi } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { WifiSnapshot } from '@shared/types'
import { Button, EmptyState, IconButton, PageHeader, Skeleton, StatusDot } from '@/components/ui'
import { errMsg } from '@/lib/util'
import { toast } from '@/stores/toast-store'

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): React.JSX.Element {
  return (
    <div className="rounded-xl border border-cx-border bg-cx-raised px-4 py-3">
      <div className="text-xs text-cx-faint">{label}</div>
      <div className="selectable mt-0.5 text-lg font-semibold tracking-tight">{value}</div>
      {hint && <div className="text-xs text-cx-muted">{hint}</div>}
    </div>
  )
}

function signalWord(rssi: number): string {
  return rssi >= -55 ? 'Excellent' : rssi >= -67 ? 'Good' : rssi >= -75 ? 'Fair' : 'Weak'
}

/** The Wi-Fi link on this Mac, a speed test, and what to change to make it faster. */
export function WifiView(): React.JSX.Element {
  const [snap, setSnap] = useState<WifiSnapshot | null>(null)
  const [testing, setTesting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setSnap(await window.cairix.wifi.status())
    } catch (e) {
      toast.error(errMsg(e))
    }
  }, [])

  // Signal moves as you walk around, so poll while the page is visible.
  useEffect(() => {
    void refresh()
    const t = setInterval(() => !document.hidden && void refresh(), 10_000)
    return () => clearInterval(t)
  }, [refresh])

  async function speedTest(): Promise<void> {
    setTesting(true)
    try {
      setSnap(await window.cairix.wifi.speedTest())
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setTesting(false)
    }
  }

  const link = snap?.link
  const speed = snap?.speed
  return (
    <div className="mx-auto max-w-[1040px] px-page-x py-page-y">
      <PageHeader
        title="Wi-Fi"
        subtitle={!snap ? 'Reading Wi-Fi…' : !snap.available ? 'Wi-Fi details are not available' : link?.connected ? `${link.band ?? ''} · channel ${link.channel ?? '?'}${link.widthMhz ? ` · ${link.widthMhz} MHz` : ''}` : 'Not connected'}
        actions={
          <>
            <Button variant="primary" icon={Gauge} busy={testing} disabled={testing || !snap?.available} onClick={() => void speedTest()}>{testing ? 'Testing… about 20 s' : 'Run speed test'}</Button>
            <IconButton icon={RefreshCw} label="Refresh now" onClick={() => void refresh()} />
          </>
        }
      />

      {!snap ? (
        <Skeleton rows={4} />
      ) : !snap.available ? (
        <EmptyState icon={Wifi} title={snap.reason ?? 'Wi-Fi details are not available'} action={<Button onClick={() => void refresh()}>Check again</Button>}>
          Signal strength, band, channel crowding and a speed test appear here.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          {link?.connected && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Signal" value={link.rssi !== undefined ? `${link.rssi} dBm` : '—'} hint={link.rssi !== undefined ? signalWord(link.rssi) : undefined} />
              <Stat label="Above noise" value={link.rssi !== undefined && link.noise !== undefined ? `${link.rssi - link.noise} dB` : '—'} hint="25 dB or more is clean" />
              <Stat label="Link rate" value={link.txRate ? `${link.txRate} Mbit/s` : '—'} hint="Between Mac and router" />
              <Stat label="Standard" value={link.phyMode ?? '—'} hint={`${link.nearby.length} other networks heard`} />
            </div>
          )}

          <section aria-label="Speed test" className="rounded-xl border border-cx-border bg-cx-raised">
            <header className="border-b border-cx-border bg-cx-surface px-4 py-2 font-medium">Internet speed</header>
            {speed ? (
              <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
                <Stat label="Download" value={`${speed.downMbps} Mbit/s`} />
                <Stat label="Upload" value={`${speed.upMbps} Mbit/s`} />
                <Stat label="Under load" value={`${speed.rpm} RPM`} hint="Round trips a minute while busy" />
                <Stat label="Idle delay" value={`${speed.idleMs} ms`} hint={`Tested ${new Date(speed.at).toLocaleTimeString()}`} />
              </div>
            ) : (
              <p className="px-4 py-3 text-cx-muted">{testing ? 'Testing download, upload and lag under load…' : 'No test yet. A test takes about 20 seconds and uses a few hundred MB of data.'}</p>
            )}
          </section>

          <section aria-label="What to change" className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
            <header className="border-b border-cx-border bg-cx-surface px-4 py-2 font-medium">What to change</header>
            {snap.tips.map((t) => (
              <div key={t.title} className="flex items-start gap-3 border-b border-cx-border/60 px-4 last:border-0" style={{ paddingTop: 'var(--cx-row-y)', paddingBottom: 'var(--cx-row-y)' }}>
                <span className="mt-1.5"><StatusDot tone={t.tone} /></span>
                <span className="min-w-0">
                  <span className="block font-medium">{t.title}</span>
                  <span className="block text-sm text-cx-muted">{t.detail}</span>
                </span>
              </div>
            ))}
          </section>
        </div>
      )}
    </div>
  )
}
