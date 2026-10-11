import type { Config } from 'tailwindcss';

/**
 * Wally brand tokens — "wally - branding.pdf" v1, see docs/BRAND.md.
 *
 * Dusty blue is strictly functional: the pin in the mark, the one primary action on a
 * screen, and the selection state. It is never a note colour and never a priority marker —
 * see globals.css, ColorSwatchPicker and noteDerived.ts for where that boundary is
 * enforced in code.
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
      /* One typeface. `head` is kept as an alias of `sans` so the 20 existing `font-head`
       * usages keep compiling; it resolves to the same stack and can be swept away later. */
      fontFamily: {
        head: ['Sora', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Sora', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      /* Six steps, nothing between them, nothing below 12. Tracking is baked into the
       * tuple rather than declared as a letterSpacing scale, so a size and its tracking can
       * never drift apart. 15 is the note title on the wall; 22 the panel title; 40 display.
       *
       * Keep the key list in sync with FONT_SIZES in src/lib/cn.ts — tailwind-merge has to
       * be told about every one of them or it treats the class as a text *colour*. */
      fontSize: {
        12: ['12px', { lineHeight: '1.35' }],
        14: ['14px', { lineHeight: '1.55' }],
        15: ['15px', { lineHeight: '1.35', letterSpacing: '-0.01em' }],
        22: ['22px', { lineHeight: '1.22', letterSpacing: '-0.03em' }],
        32: ['32px', { lineHeight: '1.12', letterSpacing: '-0.036em' }],
        40: ['40px', { lineHeight: '1.05', letterSpacing: '-0.045em' }],
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
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '8px',
        lg: '10px',
        xl: '12px',
        '2xl': '16px',
      },
      /* Elevation is tinted with slate rather than neutral black, so cards read as sitting
       * on the linen wall instead of on a grey sheet. `pin` is the resting note shadow —
       * shallow, because a note is paper pinned flat, not a floating card. */
      boxShadow: {
        e1: '0 1px 2px rgba(34, 48, 63, 0.06), 0 1px 1px rgba(34, 48, 63, 0.04)',
        e2: '0 8px 24px rgba(34, 48, 63, 0.12)',
        e3: '0 18px 40px -8px rgba(34, 48, 63, 0.22), 0 4px 10px rgba(34, 48, 63, 0.08)',
        pin: '0 2px 4px rgba(34, 48, 63, 0.08), 0 8px 18px -10px rgba(34, 48, 63, 0.28)',
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
