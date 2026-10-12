import { useSyncExternalStore } from 'react';
import type { MutationTicket } from './mutationQueue';
import type { NoteDto } from '@wally/shared';
const tickets = new Map<string, MutationTicket>();
export const getDraftTicket = (key: string) => tickets.get(key);
let drafts: Record<string, string> = {};
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
export function setNoteDraft(key: string, value: string, ticket?: MutationTicket) {
  if (ticket) tickets.set(key, ticket);
  drafts = { ...drafts, [key]: value };
  emit();
}
export function getNoteDraft(key: string) {
  return drafts[key];
}
export function clearNoteDraft(key: string, expected?: string) {
  if (expected !== undefined && drafts[key] !== expected) return;
  tickets.delete(key);
  const next = { ...drafts };
  delete next[key];
  drafts = next;
  emit();
}
export function clearNoteDrafts() {
  tickets.clear();
  drafts = {};
  emit();
}
export function withNoteDraft<T extends NoteDto>(note: T): T {
  return {
    ...note,
    title: drafts[`${note.id}:title`] ?? note.title,
    description: drafts[`${note.id}:description`] ?? note.description,
  };
}
export function useNoteDrafts() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => drafts,
  );
}
