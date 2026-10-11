import type { Config } from 'tailwindcss';

/**
 * Wally design tokens — Graphite + Marigold, see docs/BRAND.md.
 *
 * Colours are wired as CSS custom properties (see src/styles/globals.css) holding plain
 * colour values — not the hsl()-triplet convention shadcn's docs default to. Components
 * only ever reference the Tailwind utility (e.g. `bg-background`), so a var can hold any
 * valid CSS colour, and the `.dark` class re-points every one of them in one place.
 */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      /* One family for reading, its mono sibling for keyboard hints and figures. */
      fontFamily: {
        sans: ['Geist', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      /* Six steps, nothing between them, nothing below 12. Tracking is baked into the
       * tuple rather than declared as a letterSpacing scale, so a size and its tracking can
       * never drift apart. 13 is the control size (buttons, menus, inputs); 14 body and the
       * note title; 16 the panel title; 20 page titles; 28 display.
       *
       * Keep the key list in sync with FONT_SIZES in src/lib/cn.ts — tailwind-merge has to
       * be told about every one of them or it treats the class as a text *colour*. */
      fontSize: {
        12: ['12px', { lineHeight: '1.4' }],
        13: ['13px', { lineHeight: '1.45', letterSpacing: '-0.003em' }],
        14: ['14px', { lineHeight: '1.5', letterSpacing: '-0.006em' }],
        16: ['16px', { lineHeight: '1.4', letterSpacing: '-0.012em' }],
        20: ['20px', { lineHeight: '1.3', letterSpacing: '-0.02em' }],
        28: ['28px', { lineHeight: '1.15', letterSpacing: '-0.03em' }],
      },
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: { DEFAULT: 'var(--card)', foreground: 'var(--card-foreground)' },
        popover: { DEFAULT: 'var(--popover)', foreground: 'var(--popover-foreground)' },
        primary: {
          DEFAULT: 'var(--primary)',
          hover: 'var(--primary-hover)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: { DEFAULT: 'var(--secondary)', foreground: 'var(--secondary-foreground)' },
        muted: { DEFAULT: 'var(--muted)', foreground: 'var(--muted-foreground)' },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          soft: 'var(--accent-soft)',
          foreground: 'var(--accent-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          hover: 'var(--destructive-hover)',
          soft: 'var(--destructive-soft)',
          foreground: 'var(--destructive-foreground)',
        },
        tooltip: { DEFAULT: 'var(--tooltip)', foreground: 'var(--tooltip-foreground)' },
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
          disabled: 'var(--fg-disabled)',
          'meta-on-note': 'var(--fg-meta-on-note)',
        },
        status: {
          success: 'var(--status-success)',
          warning: 'var(--status-warning)',
          danger: 'var(--status-danger)',
          neutral: 'var(--status-neutral)',
        },
        /* Note colours deliberately have no entry here. Every consumer reads the CSS
           variable directly (`bg-[color:var(--note-…)]`, see util/noteDerived.ts), so a
           parallel Tailwind group would be a second list to keep in sync for no gain. */
      },
      /* 6 for controls, 8 for notes and cards, 12 for panels and popovers. */
      borderRadius: {
        sm: '4px',
        DEFAULT: '6px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
      },
      /* Elevation lives in globals.css so dark mode can swap shadows for hairlines. */
      boxShadow: {
        e1: 'var(--shadow-e1)',
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)',
        pin: 'var(--shadow-pin)',
      },
      transitionDuration: {
        120: '120ms',
        150: '150ms',
        240: '240ms',
        420: '420ms',
      },
      transitionTimingFunction: {
        ds: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        /* Slight overshoot for tactile press/release feedback only. */
        tactile: 'cubic-bezier(0.34, 1.4, 0.64, 1)',
      },
      /* Radix's Presence unmounts a node as soon as it stops detecting a running CSS
       * *animation* — it does not observe transitions. Exit motion therefore has to be
       * keyframed, which is why every overlay below ships an `-out` pair. */
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'dialog-in': {
          from: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
        'dialog-out': {
          from: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
          to: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.96)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(100%)' },
        },
        'slide-in-bottom': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        'slide-out-bottom': {
          from: { transform: 'translateY(0)' },
          to: { transform: 'translateY(100%)' },
        },
        'pop-in': {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'pop-out': {
          from: { opacity: '1', transform: 'scale(1)' },
          to: { opacity: '0', transform: 'scale(0.94)' },
        },
        /* Skeletons sweep instead of pulsing — reads as loading, not as a broken element. */
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
      },
      animation: {
        'fade-in': 'fade-in 240ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'fade-out': 'fade-out 180ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'dialog-in': 'dialog-in 240ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'dialog-out': 'dialog-out 160ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'slide-in-right': 'slide-in-right 300ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'slide-out-right': 'slide-out-right 200ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'slide-in-bottom': 'slide-in-bottom 300ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'slide-out-bottom': 'slide-out-bottom 200ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'pop-in': 'pop-in 150ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        'pop-out': 'pop-out 110ms cubic-bezier(0.2, 0.7, 0.2, 1)',
        shimmer: 'shimmer 1.6s linear infinite',
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
