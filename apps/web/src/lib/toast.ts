import { useSyncExternalStore } from 'react';
import type { MessageKey } from '@/i18n/keys';

/**
 * A tiny toast store. Toasts hold catalogue KEYS, not resolved copy, so one already on screen
 * follows a language switch (see i18n/keys.ts for why that matters).
 */
export interface ToastInput {
  title: MessageKey;
  values?: Record<string, unknown>;
  tone?: 'default' | 'error';
  action?: { label: MessageKey; onClick: () => void };
  /** ms; errors stay a little longer. */
  duration?: number;
  /** Called once when the toast leaves without its action having been used. */
  onExpire?: () => void;
}

export interface Toast extends ToastInput {
  id: number;
}

const MAX_VISIBLE = 3;
let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function toast(input: ToastInput): number {
  const id = nextId++;
  const overflow = [...toasts, { ...input, id }];
  // Oldest out first, and an evicted toast still counts as expired — an undo window that
  // scrolls off must commit its action, not silently drop it.
  while (overflow.length > MAX_VISIBLE) overflow.shift()?.onExpire?.();
  toasts = overflow;
  emit();
  return id;
}

toast.error = (title: MessageKey, values?: Record<string, unknown>) =>
  toast({ title, values, tone: 'error' });

/** Removes a toast. `expired` runs its onExpire; dismissing via its action does not. */
export function dismissToast(id: number, { expired }: { expired: boolean }) {
  const found = toasts.find((t) => t.id === id);
  if (!found) return;
  toasts = toasts.filter((t) => t.id !== id);
  if (expired) found.onExpire?.();
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => toasts,
  );
}

/** Test helper. */
export function resetToasts() {
  toasts = [];
  emit();
}
