import type { Config } from 'tailwindcss';

/**
 * Finlex Platform design tokens (docs/…/design-system §4 "Platform"), reconciled per the
 * plan: apricot stays strictly functional (primary CTA / active state / focus ring),
 * never a decorative note-colour or priority-dot option — see globals.css and
 * ColorSwatchPicker/NoteCard for where that boundary is enforced in code.
 *
 * Colours are wired as CSS custom properties (see src/styles/globals.css) holding plain
 * hex values — not the hsl()-triplet convention shadcn's docs default to. shadcn's
 * components only ever reference the Tailwind utility (e.g. `bg-background`), never
 * `hsl()` directly, so a var can hold any valid CSS colour; going hex-for-hex keeps every
 * token numerically identical to the design system's documented values instead of
 * introducing manual-conversion drift.
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        head: ['Manrope', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Figtree', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        11: ['11px', { lineHeight: '1.3' }],
        12: ['12px', { lineHeight: '1.35' }],
        13: ['13px', { lineHeight: '1.4' }],
        14: ['14px', { lineHeight: '1.4' }],
        15: ['15px', { lineHeight: '1.35' }],
        18: ['18px', { lineHeight: '1.3' }],
        22: ['22px', { lineHeight: '1.2' }],
        32: ['32px', { lineHeight: '1.15' }],
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-foreground)' },
        secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        accent: { DEFAULT: 'var(--accent)', foreground: 'var(--accent-foreground)' },
        destructive: { DEFAULT: 'var(--destructive)', foreground: 'var(--destructive-foreground)' },
        border: {
          DEFAULT: 'var(--border)',
          subtle: 'var(--border-subtle)',
          strong: 'var(--border-strong)',
          input: 'var(--border-input)',
        },
        input: 'var(--input)',
        ring: 'var(--ring)',
        canvas: 'var(--canvas)',
        surface: { DEFAULT: 'var(--surface)', alt: 'var(--surface-alt)' },
        inset: { DEFAULT: 'var(--inset)', hover: 'var(--inset-hover)' },
        fg: {
          1: 'var(--fg-1)',
          2: 'var(--fg-2)',
          3: 'var(--fg-3)',
          muted: 'var(--fg-muted)',
          faint: 'var(--fg-faint)',
        },
        status: {
          success: 'var(--status-success)',
          'success-bold': 'var(--status-success-bold)',
          warning: 'var(--status-warning)',
          'warning-bold': 'var(--status-warning-bold)',
          danger: 'var(--status-danger)',
          'danger-bold': 'var(--status-danger-bold)',
          info: 'var(--status-info)',
          'info-bold': 'var(--status-info-bold)',
          neutral: 'var(--status-neutral)',
          'neutral-bold': 'var(--status-neutral-bold)',
        },
        note: {
          eis: 'var(--note-eis)',
          sand: 'var(--note-sand)',
          minze: 'var(--note-minze)',
          himmel: 'var(--note-himmel)',
        },
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
      },
      boxShadow: {
        e2: '0 8px 24px rgba(2, 71, 79, 0.12)',
      },
      transitionDuration: {
        150: '150ms',
        240: '240ms',
        420: '420ms',
      },
      transitionTimingFunction: {
        ds: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      },
      zIndex: {
        dropdown: '20',
        drawer: '40',
        header: '60',
        tooltip: '80',
        overlay: '100',
      },
    },
  },
  plugins: [],
} satisfies Config;
