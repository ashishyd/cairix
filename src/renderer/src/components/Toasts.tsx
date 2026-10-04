import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { cx } from '@/lib/util'
import { useToastStore } from '@/stores/toast-store'

const ICONS = { success: CircleCheck, error: CircleAlert, info: Info }
const TONES = { success: 'text-cx-success', error: 'text-cx-danger', info: 'text-cx-accent-text' }

export function Toasts(): React.JSX.Element {
  const { toasts, dismiss } = useToastStore()
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'} className="pointer-events-auto flex max-w-[460px] animate-pop items-center gap-2.5 rounded-xl border border-cx-border bg-cx-raised py-2 pl-3 pr-2 shadow-lg">
            <Icon size={16} className={cx('shrink-0', TONES[t.kind])} />
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                onClick={() => {
                  t.action!.run()
                  dismiss(t.id)
                }}
                className="rounded-md px-2 py-0.5 font-medium text-cx-accent-text hover:bg-cx-hover"
              >
                {t.action.label}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="rounded-md p-1 text-cx-faint hover:bg-cx-hover hover:text-cx-text">
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
