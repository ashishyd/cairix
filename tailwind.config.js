/** Colours are CSS variables (RGB channels) so themes and the accent can change at runtime. */
const v = (name) => `rgb(var(--cx-${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cx: {
          bg: v('bg'),
          surface: v('surface'),
          raised: v('raised'),
          hover: v('hover'),
          border: v('border'),
          text: v('text'),
          muted: v('muted'),
          faint: v('faint'),
          accent: v('accent'),
          'accent-text': v('accent-text'),
          'accent-fg': v('accent-fg'),
          success: v('success'),
          warning: v('warning'),
          danger: v('danger')
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', '"SF Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace']
      },
      fontSize: {
        // Typed scale — see src/shared/design.ts. Relative to --cx-font-size.
        '2xs': ['var(--cx-text-2xs)', { lineHeight: '1.35' }],
        xs: ['var(--cx-text-xs)', { lineHeight: '1.35' }],
        sm: ['var(--cx-text-sm)', { lineHeight: '1.4' }],
        base: ['var(--cx-text-base)', { lineHeight: '1.45' }],
        md: ['var(--cx-text-md)', { lineHeight: '1.4' }],
        lg: ['var(--cx-text-lg)', { lineHeight: '1.35' }],
        xl: ['var(--cx-text-xl)', { lineHeight: '1.25' }],
        '2xl': ['var(--cx-text-2xl)', { lineHeight: '1.15' }]
      },
      spacing: {
        cx1: 'var(--cx-space-1)',
        cx2: 'var(--cx-space-2)',
        cx3: 'var(--cx-space-3)',
        cx4: 'var(--cx-space-4)',
        cx5: 'var(--cx-space-5)',
        cx6: 'var(--cx-space-6)',
        cx8: 'var(--cx-space-8)',
        'page-x': 'var(--cx-page-x)',
        'page-y': 'var(--cx-page-y)',
        'row-y': 'var(--cx-row-y)'
      },
      borderRadius: { cx: 'var(--cx-radius)' },
      keyframes: {
        pop: { from: { opacity: '0', transform: 'translateY(6px) scale(.98)' }, to: { opacity: '1', transform: 'none' } },
        fade: { from: { opacity: '0' }, to: { opacity: '1' } },
        pulse2: { '0%,100%': { opacity: '1' }, '50%': { opacity: '.35' } }
      },
      animation: { pop: 'pop .16s ease-out', fade: 'fade .12s ease-out', pulse2: 'pulse2 1.6s ease-in-out infinite' }
    }
  },
  plugins: []
}
