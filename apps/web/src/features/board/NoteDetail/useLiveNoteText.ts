import { useCallback, useEffect, useRef, useState } from 'react';

/** How long typing pauses before the text is sent. The board updates on every keystroke. */
const SAVE_DELAY_MS = 500;

interface LiveNoteTextOptions {
  /** The value the server (or cache) currently holds. */
  serverValue: string;
  /** Turns what was typed into what gets stored, or null for "never store this". */
  normalize: (raw: string) => string | null;
  /** Patches the cached note so the board follows each keystroke. */
  onLocalChange: (value: string) => void;
  /** Sends the value to the server. */
  save: (value: string) => void;
}

/**
 * A note text field that saves as you type.
 *
 * Every keystroke patches the cached note so the card on the board changes instantly; the
 * request itself is debounced, and flushed on blur and when the panel closes or switches
 * note (the owning component unmounts). A server refetch never overwrites the field while
 * it has focus — landing mid-word it would put back older text and jump the caret.
 *
 * The field auto-grows to fit its content: neither the title nor the description is ever
 * clipped or given a scrollbar of its own.
 */
export function useLiveNoteText({
  serverValue,
  normalize,
  onLocalChange,
  save,
}: LiveNoteTextOptions) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(serverValue);
  const lastSaved = useRef(serverValue);
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (document.activeElement !== ref.current) setValue(serverValue);
    if (pending.current === null) lastSaved.current = serverValue;
  }, [serverValue]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const next = pending.current;
    pending.current = null;
    if (next === null || next === lastSaved.current) return;
    lastSaved.current = next;
    save(next);
  }, [save]);

  // Unmounting (closing the panel, switching note) sends what was typed.
  useEffect(() => flush, [flush]);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  }, [value, resize]);

  function onChange(raw: string) {
    setValue(raw);
    const next = normalize(raw);
    if (next === null) return;
    onLocalChange(next);
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }

  /** Saves now; a value that may not be stored is replaced by the last saved one. */
  function onBlur() {
    flush();
    if (normalize(value) === null) setValue(lastSaved.current);
  }

  return { ref, value, onChange, onBlur, resize };
}
