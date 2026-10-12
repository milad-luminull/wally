import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getRecoveries,
  isCurrentSession,
  sessionGeneration,
  type MutationTicket,
} from '@/lib/mutationQueue';
import {
  clearNoteDraft,
  getDraftTicket,
  getNoteDraft,
  setNoteDraft,
  useNoteDrafts,
} from '@/lib/noteDrafts';
const SAVE_DELAY_MS = 500;
interface LiveNoteTextOptions {
  serverValue: string;
  normalize: (raw: string) => string | null;
  onLocalChange: (value: string) => void;
  save: (value: string, ticket?: MutationTicket) => Promise<unknown> | void;
  capture?: () => MutationTicket;
  draftKey?: string;
}
/** Drafts are independent of server cache; only acknowledgement marks text as saved. */
export function useLiveNoteText({
  serverValue,
  normalize,
  onLocalChange,
  save,
  capture,
  draftKey,
}: LiveNoteTextOptions) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const drafts = useNoteDrafts();
  const observedDraft = draftKey ? drafts[draftKey] : undefined;
  const initialDraft = draftKey ? getNoteDraft(draftKey) : undefined;
  const [value, setValue] = useState(initialDraft ?? serverValue);
  const lastSaved = useRef(serverValue);
  const currentServer = useRef(serverValue);
  currentServer.current = serverValue;
  const pending = useRef<string | null>(initialDraft ?? null);
  const ticket = useRef<MutationTicket | undefined>(
    draftKey ? getDraftTicket(draftKey) : undefined,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const generation = useRef(sessionGeneration()).current;
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (pending.current !== null || inFlight.current) return;
    lastSaved.current = serverValue;
    if (document.activeElement !== ref.current) setValue(serverValue);
  }, [serverValue]);
  useEffect(() => {
    // The recovery may belong to a panel that has since closed. Observe explicit store
    // removal so discarding also releases the pending value in a remounted editor.
    if (!draftKey || observedDraft !== undefined || pending.current === null) return;
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    ticket.current = undefined;
    lastSaved.current = currentServer.current;
    setValue(currentServer.current);
  }, [draftKey, observedDraft]);
  const flushRef = useRef<() => void>(() => {});
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!isCurrentSession(generation) || inFlight.current) return;
    const next = pending.current;
    if (next === null) return;
    if (
      next === lastSaved.current &&
      !getRecoveries().some((item) => item.ticket.resource === ticket.current?.resource)
    ) {
      pending.current = null;
      ticket.current = undefined;
      if (draftKey) clearNoteDraft(draftKey, next);
      return;
    }
    const action = ticket.current;
    ticket.current = undefined;
    const acknowledge = () => {
      lastSaved.current = next;
      if (pending.current === next) {
        pending.current = null;
        ticket.current = undefined;
      }
      if (draftKey) clearNoteDraft(draftKey, next);
    };
    if (action) {
      action.onAcknowledged = acknowledge;
      action.onDiscarded = () => {
        if (pending.current !== next) return;
        if (timer.current) clearTimeout(timer.current);
        pending.current = null;
        ticket.current = undefined;
        lastSaved.current = currentServer.current;
        if (draftKey) clearNoteDraft(draftKey, next);
        setValue(currentServer.current);
      };
    }
    inFlight.current = true;
    let succeeded = false;
    void Promise.resolve(saveRef.current(next, action))
      .then(() => {
        acknowledge();
        succeeded = true;
      })
      .catch(() => {
        if (pending.current === next) ticket.current = action;
        // The queue owns retry/review. Keep both text and its original base revision.
      })
      .finally(() => {
        inFlight.current = false;
        if (
          (succeeded || pending.current !== next) &&
          pending.current !== null &&
          pending.current !== lastSaved.current
        )
          timer.current = setTimeout(() => flushRef.current(), 0);
      });
  }, [draftKey, generation]);
  flushRef.current = flush;
  useEffect(
    () => () => {
      flush();
    },
    [flush],
  );
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
    if (
      !ticket.current ||
      getRecoveries().some((item) => item.ticket.operationId === ticket.current?.operationId)
    )
      ticket.current = capture?.();
    pending.current = next;
    if (draftKey) setNoteDraft(draftKey, next, ticket.current);
    onLocalChange(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }
  function onBlur() {
    flush();
    if (normalize(value) === null) setValue(lastSaved.current);
  }
  return { ref, value, onChange, onBlur, resize };
}
