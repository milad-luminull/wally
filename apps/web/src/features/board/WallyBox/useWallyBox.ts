import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  INTAKE_MESSAGE_MAX,
  type AssistantChip,
  type AssistantConversationDto,
  type AssistantEntry,
  type IntakeOption,
  type IntakeRequest,
  type NoteDto,
  type NoteVisibility,
  type SuggestionFieldKey,
} from '@wally/shared';
import { guessIntent, type Intent } from '@/lib/capture/intentGuess';
import { localDate } from '@/lib/localDate';
import { assistantApi } from '@/lib/resources';
import { useAskAssistant, type AskOutcome } from '../Ask/useAskAssistant';
import { useCreateNote } from '../hooks/mutations/useCreateNote';
import { useQueryKeys } from '../hooks/queryKeys';
import { noteDraftOf } from './noteDraft';
import { placementAt, placementInput, type CapturePlacement } from './placement';

/** What the instant parser's kept chips decided while typing. */
export interface CaptureFields {
  dueDate: string | null;
  assigneeId: string | null;
  priority: 'HIGH' | 'LOW' | null;
}

/** The one reply the box shows; a new one replaces it (the box spec, §3.2). */
export type BoxReply =
  | { kind: 'asking'; question: string }
  | { kind: 'answer'; question: string; outcome: AskOutcome }
  | { kind: 'duplicate'; text: string; note: AssistantChip }
  | { kind: 'clarify'; question: string; options: IntakeOption[] }
  | { kind: 'status'; message: 'savedAsWritten' | 'truncated' | 'askFailed' };

export interface SendOptions {
  /** The person's choice for this message (the hint button); null lets the intake decide. */
  pinned: Intent | null;
  /** Applied only when the message is one note. */
  fields: CaptureFields;
  /** Every field the person decided: the kept chips and the place the note was written. */
  locked: SuggestionFieldKey[];
  /** The fields decided by the place alone (a zone, a filter): they hold for every note. */
  placementLocked: SuggestionFieldKey[];
  /** ⌘↵: open the note once written. */
  open: boolean;
  placement: CapturePlacement;
}

export type BoxChoice =
  IntakeOption | { action: 'open'; noteId: string } | { action: 'addAnyway'; text: string };

export interface WallyBoxController {
  /** Messages waiting for Wally, oldest first. */
  pending: { id: string; text: string }[];
  reply: BoxReply | null;
  /** Something is in flight: the box wears its ring. */
  working: boolean;
  send: (text: string, options: SendOptions) => void;
  choose: (choice: BoxChoice) => void;
  closeReply: () => void;
  /**
   * What is typed and not yet sent, and the hint the person pinned: one for the board, so the
   * docked and the anchored box show the same words wherever the box moves.
   */
  draft: string;
  setDraft: (text: string) => void;
  pinned: Intent | null;
  setPinned: (intent: Intent | null) => void;
}

interface Queued {
  id: string;
  text: string;
  options: SendOptions;
}

/** The answer's own entry: the last one Wally wrote. */
export function lastAnswer(conversation: AssistantConversationDto): AssistantEntry | undefined {
  return [...conversation.entries].reverse().find((entry) => entry.role === 'assistant');
}

const NO_FIELDS: CaptureFields = { dueDate: null, assigneeId: null, priority: null };
const ANSWER_CONTEXT_MAX = 4000;

const fieldsInput = (fields: CaptureFields) => ({
  ...(fields.dueDate ? { dueDate: fields.dueDate } : {}),
  ...(fields.assigneeId ? { assigneeId: fields.assigneeId } : {}),
  ...(fields.priority ? { priority: fields.priority } : {}),
});

/** The answer showing, as the intake reads it: so "and next week?" is a follow-up. */
function contextOf(reply: BoxReply | null): IntakeRequest['context'] {
  if (reply?.kind !== 'answer' || reply.outcome.kind !== 'answered') return undefined;
  const last = lastAnswer(reply.outcome.conversation);
  if (!last) return undefined;
  return {
    question: reply.question.slice(0, 2000),
    answer: last.text.slice(0, ANSWER_CONTEXT_MAX),
  };
}

/**
 * The Wally box's controller (docs/superpowers/specs/2026-11-08-wally-box-design.md): Enter frees
 * the box at once; each message waits as a chip and is handled one at a time, in order, so at
 * most one intake or question is in flight. The intake says what a message holds; notes are
 * written through the board's create call and handed on for their fill-in, a question is
 * answered in the box, and a duplicate or a vague message asks once. Nothing typed is lost.
 */
export function useWallyBox(args: {
  boardId: string;
  assistantEnabled: boolean;
  visibility: NoteVisibility;
  onNoteCreated: (noteId: string, locked: SuggestionFieldKey[]) => void;
  onOpenNote: (noteId: string) => void;
}): WallyBoxController {
  const { boardId, assistantEnabled, visibility } = args;
  const queryClient = useQueryClient();
  const keys = useQueryKeys();
  const { mutateAsync: createNote } = useCreateNote(boardId);
  const askAssistant = useAskAssistant(boardId);
  const [pending, setPending] = useState<Queued[]>([]);
  const [reply, setReplyState] = useState<BoxReply | null>(null);
  const [draft, setDraftState] = useState('');
  const [pinned, setPinned] = useState<Intent | null>(null);
  // The message being answered: its chip gives way to the answer's own line.
  const [answering, setAnswering] = useState<string | null>(null);

  // Read through refs: a message is handled long after the render that queued it.
  const callbacks = useRef(args);
  callbacks.current = args;
  const latestReply = useRef<BoxReply | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => void (mounted.current = false);
  }, []);
  const setReply = useCallback((next: BoxReply | null) => {
    latestReply.current = next;
    if (mounted.current) setReplyState(next);
  }, []);
  const queue = useRef<Queued[]>([]);
  const draining = useRef(false);
  /** Where the last message was written: a choice in its question back writes there too. */
  const lastSent = useRef<{ placement: CapturePlacement; placementLocked: SuggestionFieldKey[] }>({
    placement: { kind: 'list' },
    placementLocked: [],
  });
  const setDraft = useCallback((text: string) => {
    setDraftState(text);
    if (!text.trim()) setPinned(null);
  }, []);
  /** A question that could not be answered goes back, above anything typed since. */
  const restore = useCallback((text: string) => {
    if (!mounted.current) return;
    setDraftState((now) => (now.trim() ? `${text}\n${now}` : text));
  }, []);
  const nextId = useRef(0);

  const writeNote = useCallback(
    async (
      text: string,
      placement: CapturePlacement,
      extra: { fields?: CaptureFields; locked?: SuggestionFieldKey[]; open?: boolean } = {},
    ) => {
      // The full cache, read now: a filter must not hide a slot another note holds.
      const notes = queryClient.getQueryData<NoteDto[]>(keys.notes(boardId)) ?? [];
      const note = await createNote({
        ...placementInput(placement, notes),
        ...noteDraftOf(text),
        visibility,
        ...fieldsInput(extra.fields ?? NO_FIELDS),
      });
      callbacks.current.onNoteCreated(note.id, extra.locked ?? []);
      if (extra.open) callbacks.current.onOpenNote(note.id);
    },
    [boardId, createNote, keys, queryClient, visibility],
  );

  const ask = useCallback(
    async (id: string, question: string, conversationId: string | null) => {
      // Nobody would read it: a board left behind asks nothing more.
      if (!mounted.current) return;
      setAnswering(id);
      setReply({ kind: 'asking', question });
      try {
        const outcome = await askAssistant(question, conversationId);
        setReply({ kind: 'answer', question, outcome });
      } finally {
        if (mounted.current) setAnswering(null);
      }
    },
    [askAssistant, setReply],
  );

  const handle = useCallback(
    async ({ id, text, options }: Queued) => {
      lastSent.current = options;
      if (options.pinned === 'ask') {
        const showing = latestReply.current;
        await ask(
          id,
          text,
          showing?.kind === 'answer' && showing.outcome.kind === 'answered'
            ? showing.outcome.conversation.id
            : null,
        );
        return;
      }
      const showing = latestReply.current;
      const context = contextOf(showing);
      let answer;
      try {
        answer = await assistantApi.intake(boardId, {
          message: text,
          ...(context ? { context } : {}),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          today: localDate(),
        });
      } catch {
        // The words are never lost: a note is written as typed, a question goes back in the box.
        if (guessIntent(text) === 'note') {
          await writeNote(text, options.placement, options);
          setReply({ kind: 'status', message: 'savedAsWritten' });
        } else {
          restore(text);
          setReply({ kind: 'status', message: 'askFailed' });
        }
        return;
      }
      const notes = answer.items.filter((item) => item.kind === 'note');
      const other = answer.items.find((item) => item.kind !== 'note');
      const single = notes.length === 1 && !other;
      for (const [index, item] of notes.entries())
        await writeNote(
          item.text,
          placementAt(options.placement, index),
          single ? options : { locked: options.placementLocked, open: false },
        );
      if (other?.kind === 'ask')
        await ask(
          id,
          other.text,
          context && showing?.kind === 'answer' && showing.outcome.kind === 'answered'
            ? showing.outcome.conversation.id
            : null,
        );
      else if (other?.kind === 'duplicate')
        setReply({ kind: 'duplicate', text: other.text, note: other.note });
      else if (other?.kind === 'clarify')
        setReply({ kind: 'clarify', question: other.question, options: other.options });
      else if (answer.truncated) setReply({ kind: 'status', message: 'truncated' });
    },
    [ask, boardId, restore, setReply, writeNote],
  );

  const drain = useCallback(async () => {
    if (draining.current) return;
    draining.current = true;
    try {
      while (queue.current.length > 0) {
        const head = queue.current[0]!;
        try {
          await handle(head);
        } catch {
          // A note that did not save is said by the board's own error handling.
        }
        queue.current.shift();
        if (mounted.current) setPending([...queue.current]);
      }
    } finally {
      draining.current = false;
    }
  }, [handle]);

  const send = useCallback<WallyBoxController['send']>(
    (text, options) => {
      const words = text.trim();
      if (!words) return;
      // A message longer than the intake reads is a note as written: a pasted page, not a
      // question, and no words are cut.
      if (!assistantEnabled || options.pinned === 'note' || words.length > INTAKE_MESSAGE_MAX) {
        lastSent.current = options;
        void writeNote(words, options.placement, options).catch(() => {});
        return;
      }
      const item = { id: `m${nextId.current++}`, text: words, options };
      queue.current.push(item);
      setPending([...queue.current]);
      void drain();
    },
    [assistantEnabled, drain, writeNote],
  );

  const choose = useCallback<WallyBoxController['choose']>(
    (choice) => {
      setReply(null);
      switch (choice.action) {
        case 'open':
          callbacks.current.onOpenNote(choice.noteId);
          return;
        case 'addAnyway':
        case 'note':
          void writeNote(choice.text, lastSent.current.placement, {
            locked: lastSent.current.placementLocked,
          }).catch(() => {});
          return;
        case 'ask':
          queue.current.push({
            id: `m${nextId.current++}`,
            text: choice.text,
            options: {
              pinned: 'ask',
              fields: NO_FIELDS,
              locked: [],
              placementLocked: [],
              open: false,
              placement: lastSent.current.placement,
            },
          });
          setPending([...queue.current]);
          void drain();
      }
    },
    [drain, setReply, writeNote],
  );

  const closeReply = useCallback(() => setReply(null), [setReply]);

  return useMemo(
    () => ({
      pending: pending.filter(({ id }) => id !== answering).map(({ id, text }) => ({ id, text })),
      reply,
      working: pending.length > 0 || reply?.kind === 'asking',
      send,
      choose,
      closeReply,
      draft,
      setDraft,
      pinned,
      setPinned,
    }),
    [answering, choose, closeReply, draft, pending, pinned, reply, send, setDraft],
  );
}
