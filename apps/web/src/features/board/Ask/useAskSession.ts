import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantEntry } from '@wally/shared';
import type { CapturePlacement } from '../Capture/useCapture';
import { useAskAssistant, type RefusalCode } from './useAskAssistant';

/** How long an answer stays before it fades: a floor, a share per word, a ceiling (plan R5). */
export const READ_BASE_MS = 8_000;
export const READ_PER_WORD_MS = 250;
export const READ_MAX_MS = 30_000;
/** The fade itself, the length of `animate-fade-out`; the card is removed once it has run. */
export const FADE_MS = 180;

export function readingTimeMs(text: string): number {
  const trimmed = text.trim();
  const words = trimmed ? trimmed.split(/\s+/).length : 0;
  return Math.min(READ_MAX_MS, READ_BASE_MS + words * READ_PER_WORD_MS);
}

export type AskPhase = 'asking' | 'answered' | 'refused' | 'failed' | 'fading';

/** One question on the wall, from Enter until its card has faded (RFC-0005-wallybot-inline.md §3.6). */
export interface AskSession {
  /** Tells this question's card and its late callbacks apart from the next one's. */
  id: number;
  /** Where the question was written: the card takes that place (R3). */
  placement: CapturePlacement;
  question: string;
  phase: AskPhase;
  /** The answer entry of the turn, once it arrived (R9). */
  answer: AssistantEntry | null;
  refusal: { code: RefusalCode; resetsAt: string | null } | null;
  /** Held by the person: no fade until unpinned or closed (R5). */
  pinned: boolean;
  /** Held by hover or focus on the card: the clock waits (R5). */
  paused: boolean;
  /** Asked with Enter: the card takes the focus on mount. Asked by a blur, the focus stays
   *  where the person put it (R8). */
  takeFocus: boolean;
}

export interface AskController {
  session: AskSession | null;
  ask: (question: string, placement: CapturePlacement, takeFocus?: boolean) => void;
  setPinned: (pinned: boolean) => void;
  /** Esc or the card's ×: the card fades now. */
  dismiss: () => void;
  pause: (paused: boolean) => void;
}

/**
 * The shell's side of a question (RFC-0005-wallybot-inline.md §3.6): one card at a time, its outcome,
 * and the reading clock that fades it. Follow-ups continue the conversation the current card
 * came from; once the card is gone, the next question starts a new one (R4).
 */
export function useAskSession(boardId: string): AskController {
  const askTurn = useAskAssistant(boardId);
  const [session, setSession] = useState<AskSession | null>(null);
  const nextId = useRef(1);
  /** The question whose outcome may still land; a dismissed or replaced one is ignored. */
  const liveId = useRef<number | null>(null);
  /** The conversation the cards on this page continue, while one of them still shows (R4). */
  const conversationId = useRef<string | null>(null);
  /** Reading time left before the fade, carried across pauses, for the session it belongs to:
   *  a replaced card's clock, stopping late, never takes from the next card's time. */
  const remaining = useRef<{ id: number; ms: number }>({ id: 0, ms: READ_BASE_MS });
  const setRemaining = useCallback((id: number, ms: number) => {
    remaining.current = { id, ms };
  }, []);
  const latest = useRef(session);
  latest.current = session;

  const update = useCallback((id: number, patch: (s: AskSession) => AskSession) => {
    setSession((s) => (s && s.id === id ? patch(s) : s));
  }, []);

  const fade = useCallback(
    (id: number) => {
      if (liveId.current === id) liveId.current = null;
      update(id, (s) => (s.phase === 'fading' ? s : { ...s, phase: 'fading' }));
    },
    [update],
  );

  // The fade runs its FADE_MS and the card goes; the next question then starts afresh.
  const sessionId = session?.id;
  const phase = session?.phase;
  useEffect(() => {
    if (phase !== 'fading' || sessionId === undefined) return;
    const timer = setTimeout(() => {
      setSession((s) => (s && s.id === sessionId ? null : s));
      conversationId.current = null;
    }, FADE_MS);
    return () => clearTimeout(timer);
  }, [phase, sessionId]);

  // The reading clock: runs once the outcome is on the card, waits while pinned or held, and
  // keeps what is left of the time across pauses.
  const ticking =
    session !== null &&
    phase !== 'asking' &&
    phase !== 'fading' &&
    !session.pinned &&
    !session.paused;
  useEffect(() => {
    if (!ticking || sessionId === undefined) return;
    const started = Date.now();
    const left = remaining.current.id === sessionId ? remaining.current.ms : READ_BASE_MS;
    const timer = setTimeout(() => fade(sessionId), left);
    return () => {
      clearTimeout(timer);
      if (remaining.current.id === sessionId)
        setRemaining(sessionId, Math.max(0, left - (Date.now() - started)));
    };
  }, [fade, sessionId, setRemaining, ticking]);

  const ask = useCallback<AskController['ask']>(
    (question, placement, takeFocus = true) => {
      const id = nextId.current++;
      liveId.current = id;
      setRemaining(id, READ_BASE_MS);
      setSession({
        id,
        placement,
        question,
        phase: 'asking',
        answer: null,
        refusal: null,
        pinned: false,
        paused: false,
        takeFocus,
      });
      void (async () => {
        const outcome = await askTurn(question, conversationId.current);
        // Dismissed or replaced meanwhile: the answer was not waited for (R4, R5).
        if (liveId.current !== id) return;
        if (outcome.kind === 'answered') {
          conversationId.current = outcome.conversation.id;
          const entries = outcome.conversation.entries;
          const last = entries[entries.length - 1];
          const answer = last && last.role === 'assistant' ? last : null;
          if (!answer) {
            // A turn that ends without the answer has nothing to show: it is said as a failure.
            setRemaining(id, READ_BASE_MS);
            update(id, (s) => ({ ...s, phase: 'failed' }));
            return;
          }
          setRemaining(id, readingTimeMs(answer.text));
          update(id, (s) => ({ ...s, phase: 'answered', answer }));
        } else if (outcome.kind === 'refused') {
          setRemaining(id, READ_BASE_MS);
          update(id, (s) => ({
            ...s,
            phase: 'refused',
            refusal: { code: outcome.code, resetsAt: outcome.resetsAt },
          }));
        } else {
          setRemaining(id, READ_BASE_MS);
          update(id, (s) => ({ ...s, phase: 'failed' }));
        }
      })();
    },
    [askTurn, setRemaining, update],
  );

  const setPinned = useCallback<AskController['setPinned']>(
    (pinned) => {
      const s = latest.current;
      if (!s || s.phase === 'fading') return;
      // Already so: the clock keeps what it has left.
      if (s.pinned === pinned) return;
      // Unpinned, the card gets its whole reading time again.
      if (!pinned)
        setRemaining(
          s.id,
          s.phase === 'answered' ? readingTimeMs(s.answer?.text ?? '') : READ_BASE_MS,
        );
      update(s.id, (x) => (x.pinned === pinned ? x : { ...x, pinned }));
    },
    [setRemaining, update],
  );

  const dismiss = useCallback(() => {
    const s = latest.current;
    if (s) fade(s.id);
  }, [fade]);

  const pause = useCallback<AskController['pause']>(
    (paused) => {
      const s = latest.current;
      if (s) update(s.id, (x) => (x.paused === paused ? x : { ...x, paused }));
    },
    [update],
  );

  return useMemo(
    () => ({ session, ask, setPinned, dismiss, pause }),
    [ask, dismiss, pause, session, setPinned],
  );
}
