import { Gauge, ImageUp, RefreshCw, Router, Sparkles, Wifi } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { WifiSnapshot } from '@shared/types'
import { Button, Dialog, EmptyState, IconButton, PageHeader, Skeleton, StatusDot } from '@/components/ui'
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

/** Asked once: router details as text, or read from a photo or screenshot by Claude. */
function RouterDialog({ initial, onClose, onSaved }: { initial: string; onClose: () => void; onSaved: (s: WifiSnapshot) => void }): React.JSX.Element {
  const [text, setText] = useState(initial)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function readImage(): Promise<void> {
    setReading(true)
    try {
      const read = await window.cairix.wifi.readRouterImage()
      if (read !== null) setText(read)
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setReading(false)
    }
  }

  async function save(): Promise<void> {
    setSaving(true)
    try {
      onSaved(await window.cairix.wifi.saveRouter(text))
    } catch (e) {
      toast.error(errMsg(e))
      setSaving(false)
    }
  }

  return (
    <Dialog
      title="Your router"
      description="Asked once, so Claude can give steps for your exact router."
      onClose={onClose}
      width={620}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" busy={saving} disabled={saving || reading || !text.trim()} onClick={() => void save()}>Save</Button></>}
    >
      <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, 4000))} rows={8} aria-label="Router details" placeholder="TP-Link Archer AX55, Wi-Fi 6, 2.4 and 5 GHz with the same name, admin page at 192.168.0.1, firmware 1.1.2" className="no-drag selectable w-full resize-none rounded-lg border border-cx-border bg-cx-raised p-3 outline-none focus:border-cx-accent" />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-cx-faint">Brand and model are enough. Passwords and keys are masked before saving. An image is read once by Claude (capped at $0.15) and not kept.</p>
        <Button icon={ImageUp} busy={reading} disabled={reading || saving} onClick={() => void readImage()}>{reading ? 'Reading…' : 'Read from image'}</Button>
      </div>
    </Dialog>
  )
}

/** The Wi-Fi link on this Mac, a speed test, and what to change to make it faster. */
export function WifiView(): React.JSX.Element {
  const [snap, setSnap] = useState<WifiSnapshot | null>(null)
  const [testing, setTesting] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [editRouter, setEditRouter] = useState(false)
  // Set when "speed it up" was clicked before the router was known: plan right after saving it.
  const [planAfterSave, setPlanAfterSave] = useState(false)

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

  async function aiPlan(): Promise<void> {
    setPlanning(true)
    try {
      setSnap(await window.cairix.wifi.aiPlan())
    } catch (e) {
      toast.error(errMsg(e))
    } finally {
      setPlanning(false)
    }
  }

  function speedUp(): void {
    if (snap?.router) return void aiPlan()
    setPlanAfterSave(true)
    setEditRouter(true)
  }

  const link = snap?.link
  const speed = snap?.speed
  const plan = snap?.plan
  const slow = !!speed && !!link?.connected && !!snap?.tips.some((t) => t.tone !== 'success')
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
            <header className="flex items-center justify-between gap-3 border-b border-cx-border bg-cx-surface px-4 py-2">
              <span className="font-medium">What to change</span>
              {slow && <Button size="sm" variant="primary" icon={Sparkles} busy={planning} disabled={planning} onClick={speedUp}>{planning ? 'Claude is planning…' : 'Ask Claude to speed it up'}</Button>}
            </header>
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

          {plan && (
            <section aria-label="Claude's plan" className="overflow-hidden rounded-xl border border-cx-border bg-cx-raised">
              <header className="flex items-center justify-between gap-3 border-b border-cx-border bg-cx-surface px-4 py-2">
                <span className="font-medium">Claude's plan for your router</span>
                <span className="text-xs text-cx-faint">{new Date(plan.at).toLocaleTimeString()}{plan.costUsd !== undefined ? ` · $${plan.costUsd.toFixed(3)}` : ''}</span>
              </header>
              <p className="selectable px-4 pt-3 text-cx-muted">{plan.summary}</p>
              <ol className="selectable space-y-3 p-4">
                {plan.steps.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cx-accent text-2xs font-semibold text-cx-accent-fg">{i + 1}</span>
                    <span className="min-w-0">
                      <span className="block font-medium">{s.title}</span>
                      <span className="block whitespace-pre-wrap text-sm">{s.how}</span>
                      <span className="block text-sm text-cx-faint">{s.why}</span>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="border-t border-cx-border px-4 py-2 text-xs text-cx-faint">Make one change at a time, then run the speed test again to see what helped.</p>
            </section>
          )}

          <section aria-label="Your router" className="flex items-start justify-between gap-3 rounded-xl border border-cx-border bg-cx-raised px-4 py-3">
            <span className="flex min-w-0 items-start gap-3">
              <Router size={16} className="mt-0.5 shrink-0 text-cx-muted" />
              <span className="min-w-0">
                <span className="block font-medium">Your router</span>
                <span className="selectable block whitespace-pre-wrap text-sm text-cx-muted">{snap.router ?? 'Not added yet. Add it once so Claude can give steps for your exact router.'}</span>
              </span>
            </span>
            <Button size="sm" onClick={() => setEditRouter(true)}>{snap.router ? 'Edit' : 'Add router'}</Button>
          </section>
        </div>
      )}
      {editRouter && (
        <RouterDialog
          initial={snap?.router ?? ''}
          onClose={() => {
            setEditRouter(false)
            setPlanAfterSave(false)
          }}
          onSaved={(s) => {
            setSnap(s)
            setEditRouter(false)
            if (planAfterSave && s.router) void aiPlan()
            setPlanAfterSave(false)
          }}
        />
      )}
    </div>
  )
}
