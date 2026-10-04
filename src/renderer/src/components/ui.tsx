import { LoaderCircle, X, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { useEscapeKey } from '@/lib/hooks'
import { cx } from '@/lib/util'

// ───────────────────────── Button ─────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-cx-accent text-cx-accent-fg hover:brightness-110 active:brightness-95 shadow-sm',
  secondary: 'bg-cx-raised text-cx-text border border-cx-border hover:bg-cx-hover',
  ghost: 'text-cx-muted hover:bg-cx-hover hover:text-cx-text',
  danger: 'bg-cx-danger text-white hover:brightness-110 active:brightness-95 shadow-sm'
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  icon?: LucideIcon
  busy?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, busy, children, className, disabled, ...rest }: ButtonProps): React.JSX.Element {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'no-drag inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-sm' : 'h-8 px-3.5',
        VARIANTS[variant],
        className
      )}
    >
      {busy ? <LoaderCircle size={14} className="animate-spin" /> : Icon && <Icon size={size === 'sm' ? 13 : 14} />}
      {children}
    </button>
  )
}

/** Icon-only button. `label` is required: it is both the tooltip and the accessible name. */
export function IconButton({
  icon: Icon,
  label,
  size = 15,
  tone = 'normal',
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: LucideIcon
  label: string
  size?: number
  tone?: 'normal' | 'danger'
}): React.JSX.Element {
  return (
    <button
      {...rest}
      title={label}
      aria-label={label}
      className={cx(
        'no-drag inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-cx-muted transition-colors disabled:opacity-40',
        tone === 'danger' ? 'hover:bg-cx-danger/10 hover:text-cx-danger' : 'hover:bg-cx-hover hover:text-cx-text',
        className
      )}
    >
      <Icon size={size} />
    </button>
  )
}

// ───────────────────────── small bits ─────────────────────────

export function Chip({
  children,
  tone = 'neutral',
  className,
  title
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
  className?: string
  title?: string
}): React.JSX.Element {
  const tones = {
    neutral: 'bg-cx-hover text-cx-muted',
    accent: 'bg-cx-accent/12 text-cx-accent-text',
    success: 'bg-cx-success/12 text-cx-success',
    warning: 'bg-cx-warning/14 text-cx-warning',
    danger: 'bg-cx-danger/12 text-cx-danger'
  }
  return (
    <span title={title} className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-px text-xs font-medium leading-snug', tones[tone], className)}>
      {children}
    </span>
  )
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="rounded border border-cx-border bg-cx-surface px-1 font-sans text-2xs font-medium text-cx-muted">
      {children}
    </kbd>
  )
}

export function StatusDot({ tone, pulse }: { tone: 'success' | 'warning' | 'danger' | 'muted'; pulse?: boolean }): React.JSX.Element {
  const color = { success: 'bg-cx-success', warning: 'bg-cx-warning', danger: 'bg-cx-danger', muted: 'bg-cx-faint/60' }[tone]
  return <span className={cx('inline-block h-2 w-2 shrink-0 rounded-full', color, pulse && 'animate-pulse2')} />
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }): React.JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'no-drag relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40',
        checked ? 'bg-cx-accent' : 'bg-cx-faint/40'
      )}
    >
      <span className={cx('absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-[2px]')} />
    </button>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }): React.JSX.Element {
  return (
    <div role="radiogroup" className="no-drag inline-flex rounded-lg bg-cx-hover p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md px-3 py-1 text-sm font-medium transition-colors',
            o.value === value ? 'bg-cx-raised text-cx-text shadow-sm' : 'text-cx-muted hover:text-cx-text'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-16 text-center animate-fade">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-cx-accent/12 text-cx-accent-text">
        <Icon size={22} />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children && <div className="mt-1.5 text-cx-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

/** Consistent page title block for Home and Machine views. */
export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-cx-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

/** Pulsing placeholder for loading lists and panels. */
export function Skeleton({ className, rows = 1 }: { className?: string; rows?: number }): React.JSX.Element {
  return (
    <div className={cx('space-y-2', className)} aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-3 animate-pulse2 rounded-md bg-cx-hover"
          style={{ width: `${88 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  )
}

/** One alert style for warnings, errors and tips across panels. */
export function InlineAlert({
  tone = 'warning',
  children,
  icon: Icon
}: {
  tone?: 'warning' | 'danger' | 'info'
  children: ReactNode
  icon?: LucideIcon
}): React.JSX.Element {
  const styles = {
    warning: 'bg-cx-warning/12 text-cx-warning',
    danger: 'bg-cx-danger/10 text-cx-danger',
    info: 'bg-cx-accent/10 text-cx-accent-text'
  }
  return (
    <p className={cx('flex items-start gap-2 rounded-lg p-3', styles[tone])} role={tone === 'danger' ? 'alert' : undefined}>
      {Icon && <Icon size={15} className="mt-0.5 shrink-0" />}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

// ───────────────────────── Dialog ─────────────────────────

export function Dialog({
  title,
  onClose,
  children,
  footer,
  width = 520,
  description
}: {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: number
  description?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEscapeKey(onClose, true, true)
  useEffect(() => {
    // Focus the dialog so keyboard users land inside it, unless something inside already took focus.
    if (!ref.current?.contains(document.activeElement)) ref.current?.focus()
  }, [])
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-6 pt-[12vh] animate-fade" onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ width }}
        className="no-drag flex max-h-[76vh] max-w-full flex-col rounded-2xl border border-cx-border bg-cx-raised shadow-2xl outline-none animate-pop"
      >
        <div className="flex items-start justify-between gap-4 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">{title}</h2>
            {description && <p className="mt-0.5 text-cx-muted">{description}</p>}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 border-t border-cx-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
