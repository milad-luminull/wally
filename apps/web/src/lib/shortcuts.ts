import { useEffect, useRef } from 'react';

/**
 * Keyboard shortcuts.
 *
 * Keys are written the way they are shown: `n`, `/`, `?`, `mod+k` (⌘ on a Mac, Ctrl
 * elsewhere), and two-key sequences like `g h`. Single keys never fire while the user is
 * typing — an `n` in a note title must stay an `n` — and nothing fires while a dialog or
 * menu holds focus, unless a binding opts in with `allowInInputs`.
 */
export interface Shortcut {
  keys: string;
  handler: (event: KeyboardEvent) => void;
  /** Fire even when focus is in a text field (for `mod+` chords like ⌘K). */
  allowInInputs?: boolean;
  /**
   * The handler decides whether the key's default is prevented, so a key it has no use for
   * this time (⌘Z with nothing to undo) still reaches the browser. Otherwise a matched key
   * is always prevented.
   */
  handlerOwnsDefault?: boolean;
}

const SEQUENCE_TIMEOUT_MS = 1000;

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '');

/** `mod` rendered for the current platform, for hint chips. */
export const MOD_KEY = isMac ? '⌘' : 'Ctrl';

/** The Alt/Option key, for hint chips. */
export const ALT_KEY = isMac ? '⌥' : 'Alt';

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
}

/** A layer above the board (dialog, sheet, popover, select) owns the keyboard. */
export function overlayIsOpen(): boolean {
  return Boolean(
    document.querySelector(
      '[role="dialog"], [role="alertdialog"], [data-radix-popper-content-wrapper]',
    ),
  );
}

function matchesChord(event: KeyboardEvent, chord: string): boolean {
  const parts = chord.toLowerCase().split('+');
  const key = parts.pop();
  const wantsMod = parts.includes('mod');
  const mod = isMac ? event.metaKey : event.ctrlKey;
  if (wantsMod !== mod) return false;
  if (!wantsMod && (event.metaKey || event.ctrlKey || event.altKey)) return false;
  const pressed = event.key.toLowerCase();
  return pressed === key || (key === 'enter' && pressed === 'enter');
}

export function useKeyboardShortcuts(shortcuts: Shortcut[], enabled = true) {
  // Read through a ref so callers can pass a fresh array every render without re-binding.
  const latest = useRef(shortcuts);
  latest.current = shortcuts;
  const pendingPrefix = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const typing = isTypingTarget(event.target);
      const prefix = pendingPrefix.current;
      pendingPrefix.current = null;

      for (const shortcut of latest.current) {
        const steps = shortcut.keys.split(' ');
        const blocked = !shortcut.allowInInputs && (typing || overlayIsOpen());
        if (blocked) continue;

        if (steps.length === 2) {
          if (
            prefix &&
            prefix.key === steps[0] &&
            Date.now() - prefix.at < SEQUENCE_TIMEOUT_MS &&
            matchesChord(event, steps[1]!)
          ) {
            if (!shortcut.handlerOwnsDefault) event.preventDefault();
            shortcut.handler(event);
            return;
          }
          continue;
        }
        if (matchesChord(event, steps[0]!)) {
          if (!shortcut.handlerOwnsDefault) event.preventDefault();
          shortcut.handler(event);
          return;
        }
      }

      // Remember a possible sequence prefix (e.g. the `g` of `g h`).
      const isPrefix = latest.current.some((s) => {
        const [first, second] = s.keys.split(' ');
        return second !== undefined && first === event.key.toLowerCase();
      });
      if (isPrefix && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        pendingPrefix.current = { key: event.key.toLowerCase(), at: Date.now() };
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/*
 * App-wide open requests. The palette and the shortcuts sheet are mounted once, by the board;
 * menus anywhere can ask for them without threading callbacks through every layer.
 */
type OpenRequest = 'palette' | 'shortcuts' | 'share';
const eventName = (kind: OpenRequest) => `wally:open-${kind}`;

export function requestOpen(kind: OpenRequest) {
  window.dispatchEvent(new Event(eventName(kind)));
}

export const openCommandPalette = () => requestOpen('palette');
export const openShortcutsHelp = () => requestOpen('shortcuts');

export function useOpenRequest(kind: OpenRequest, open: () => void) {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const listener = () => latest.current();
    window.addEventListener(eventName(kind), listener);
    return () => window.removeEventListener(eventName(kind), listener);
  }, [kind]);
}
