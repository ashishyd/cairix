/**
 * Typed design scale. CSS variables in globals.css and Tailwind theme keys
 * in tailwind.config.js must stay in sync with these names.
 *
 * Type sizes are relative to `--cx-font-size` (Settings → Text size), so the
 * whole UI scales together. Spacing is absolute px for predictable chrome.
 */

export const TYPE_SCALE = {
  '2xs': { role: 'Keyboard hints, dense mono chrome', remOfBase: 0.81 },
  xs: { role: 'Section labels, chips, tertiary chrome', remOfBase: 0.85 },
  sm: { role: 'Secondary copy, metadata, helper text', remOfBase: 0.92 },
  base: { role: 'Body / default UI text', remOfBase: 1 },
  md: { role: 'Emphasized body, dialog subtitles', remOfBase: 1.08 },
  lg: { role: 'Section titles, dialog titles', remOfBase: 1.15 },
  xl: { role: 'Page titles', remOfBase: 1.54 },
  '2xl': { role: 'Dashboard / plugin stat figures', remOfBase: 2 }
} as const

export type TypeScaleKey = keyof typeof TYPE_SCALE

export const SPACE_SCALE = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  pageX: 32,
  pageY: 24,
  rowYComfortable: 10,
  rowYCompact: 6
} as const

export type SpaceScaleKey = keyof typeof SPACE_SCALE

/** Tailwind class helpers used across the UI. */
export const TYPE_CLASS = {
  '2xs': 'text-2xs',
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  md: 'text-md',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl'
} as const satisfies Record<TypeScaleKey, string>

/** Repeated chrome pattern: uppercase section eyebrow. */
export const LABEL_CLASS = 'text-xs font-semibold uppercase tracking-wider text-cx-faint'
