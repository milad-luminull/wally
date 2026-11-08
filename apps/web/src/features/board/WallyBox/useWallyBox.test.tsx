import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { AssistantConversationDto, IntakeResponse, NoteDto } from '@wally/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  assistantApi: { intake: vi.fn(), turn: vi.fn() },
  notesApi: { create: vi.fn() },
}));

import { assistantApi, notesApi } from '@/lib/resources';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { useWallyBox, type SendOptions } from './useWallyBox';

const BOARD = 'board-1';
const NO_FIELDS = { dueDate: null, assigneeId: null, priority: null };
const at = { kind: 'free', x: 100, y: 200 } as const;
const send = (over: Partial<SendOptions> = {}): SendOptions => ({
  pinned: null,
  fields: NO_FIELDS,
  locked: [],
  open: false,
  placement: at,
  ...over,
});

let created = 0;
const note = (input: Partial<NoteDto>): NoteDto =>
  ({ id: `n${++created}`, title: '', description: '', ...input }) as NoteDto;
const conversation = (text: string, id = 'c1'): AssistantConversationDto => ({
  id,
  boardId: BOARD,
  status: 'OPEN',
  model: 'm',
  entries: [
    {
      role: 'assistant',
      text,
      chips: [{ id: 'n9', title: 'Call Andrea' }],
      partial: false,
      stopped: null,
      at: new Date().toISOString(),
    },
  ],
});
/** An intake answer the test releases by hand. */
function holdIntake() {
  const answers: ((value: IntakeResponse | Error) => void)[] = [];
  vi.mocked(assistantApi.intake).mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        answers.push((value) => (value instanceof Error ? reject(value) : resolve(value)));
      }),
  );
  return async (value: IntakeResponse | Error) => {
    await act(async () => {
      answers.shift()?.(value);
      await new Promise((r) => setTimeout(r, 0));
    });
  };
}
const settle = () => act(async () => new Promise((r) => setTimeout(r, 0)));

function setup(assistantEnabled = true) {
  const queryClient = createTestQueryClient();
  const onNoteCreated = vi.fn();
  const onOpenNote = vi.fn();
  const onRestoreText = vi.fn();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () =>
      useWallyBox({
        boardId: BOARD,
        assistantEnabled,
        visibility: 'SHARED',
        onNoteCreated,
        onOpenNote,
        onRestoreText,
      }),
    { wrapper },
  );
  return { ...hook, onNoteCreated, onOpenNote, onRestoreText };
}

beforeEach(() => {
  vi.clearAllMocks();
  created = 0;
  vi.mocked(notesApi.create).mockImplementation(async (_board, input) => note(input));
  vi.mocked(assistantApi.turn).mockResolvedValue({
    conversation: conversation('Call Andrea is waiting on the offer.'),
  });
});

describe('useWallyBox', () => {
  it('assistant off: Enter creates one note at the placement, no intake call', async () => {
    const { result, onNoteCreated } = setup(false);
    act(() => result.current.send('call irem wed', send()));
    await settle();
    expect(assistantApi.intake).not.toHaveBeenCalled();
    expect(notesApi.create).toHaveBeenCalledWith(
      BOARD,
      expect.objectContaining({ title: 'call irem wed', freeX: 100, freeY: 200 }),
    );
    expect(onNoteCreated).toHaveBeenCalledWith('n1', []);
    expect(result.current.pending).toEqual([]);
  });

  it('pinned note skips the intake', async () => {
    const { result } = setup();
    act(() => result.current.send('what is due?', send({ pinned: 'note' })));
    await settle();
    expect(assistantApi.intake).not.toHaveBeenCalled();
    expect(notesApi.create).toHaveBeenCalledWith(
      BOARD,
      expect.objectContaining({ title: 'what is due?' }),
    );
  });

  it('two notes from one message are created in order and each asks for a fill-in', async () => {
    const answer = holdIntake();
    const { result, onNoteCreated } = setup();
    act(() => result.current.send('dentist thu, ask tom re budget', send()));
    expect(result.current.pending).toEqual([
      { id: expect.any(String), text: 'dentist thu, ask tom re budget' },
    ]);
    expect(result.current.working).toBe(true);
    await answer({
      items: [
        { kind: 'note', text: 'Dentist Thursday' },
        { kind: 'note', text: 'Ask Tom about the budget' },
      ],
      truncated: false,
    });
    const titles = vi.mocked(notesApi.create).mock.calls.map(([, input]) => input.title);
    expect(titles).toEqual(['Dentist Thursday', 'Ask Tom about the budget']);
    expect(onNoteCreated.mock.calls.map(([id]) => id)).toEqual(['n1', 'n2']);
    expect(result.current.pending).toEqual([]);
    expect(result.current.working).toBe(false);
  });

  it('chip fields go to a single note and not to split notes', async () => {
    const answer = holdIntake();
    const { result } = setup();
    const fields = { dueDate: '2026-11-13', assigneeId: null, priority: 'HIGH' as const };
    act(() =>
      result.current.send('renew car insurance fri', send({ fields, locked: ['dueDate'] })),
    );
    await answer({ items: [{ kind: 'note', text: 'renew car insurance fri' }], truncated: false });
    expect(vi.mocked(notesApi.create).mock.calls[0]![1]).toMatchObject({
      dueDate: '2026-11-13',
      priority: 'HIGH',
    });
    act(() => result.current.send('a and b', send({ fields, locked: ['dueDate'] })));
    await answer({
      items: [
        { kind: 'note', text: 'A' },
        { kind: 'note', text: 'B' },
      ],
      truncated: false,
    });
    expect(vi.mocked(notesApi.create).mock.calls[1]![1]).not.toHaveProperty('dueDate');
    expect(vi.mocked(notesApi.create).mock.calls[2]![1]).not.toHaveProperty('priority');
  });

  it('an ask shows asking, then the answer', async () => {
    const answer = holdIntake();
    const { result } = setup();
    act(() => result.current.send('what is blocking munich', send()));
    await answer({ items: [{ kind: 'ask', text: 'what is blocking munich' }], truncated: false });
    expect(assistantApi.turn).toHaveBeenCalledWith(
      BOARD,
      expect.objectContaining({ message: 'what is blocking munich' }),
    );
    expect(result.current.reply).toMatchObject({
      kind: 'answer',
      question: 'what is blocking munich',
      outcome: { kind: 'answered' },
    });
    expect(notesApi.create).not.toHaveBeenCalled();
  });

  it('a follow-up while an answer shows sends context and continues the conversation', async () => {
    const answer = holdIntake();
    const { result } = setup();
    act(() => result.current.send('what is due', send()));
    await answer({ items: [{ kind: 'ask', text: 'what is due' }], truncated: false });
    act(() => result.current.send('and next week?', send()));
    expect(vi.mocked(assistantApi.intake).mock.calls[1]![1]).toMatchObject({
      message: 'and next week?',
      context: { question: 'what is due', answer: 'Call Andrea is waiting on the offer.' },
    });
    await answer({ items: [{ kind: 'ask', text: 'And next week?' }], truncated: false });
    expect(vi.mocked(assistantApi.turn).mock.calls[1]![1]).toMatchObject({
      message: 'And next week?',
      conversationId: 'c1',
    });
  });

  it('duplicate shows the notice; Add anyway creates the note; Open it opens it', async () => {
    const answer = holdIntake();
    const { result, onOpenNote } = setup();
    act(() => result.current.send('update the premium table', send()));
    const dup = { id: 'n7', title: 'Update premium table to v2' };
    await answer({
      items: [{ kind: 'duplicate', text: 'update the premium table', note: dup }],
      truncated: false,
    });
    expect(result.current.reply).toEqual({
      kind: 'duplicate',
      text: 'update the premium table',
      note: dup,
    });
    expect(notesApi.create).not.toHaveBeenCalled();
    act(() => result.current.choose({ action: 'open', noteId: 'n7' }));
    expect(onOpenNote).toHaveBeenCalledWith('n7');
    expect(result.current.reply).toBeNull();
    act(() => result.current.choose({ action: 'addAnyway', text: 'update the premium table' }));
    await settle();
    expect(notesApi.create).toHaveBeenCalledWith(
      BOARD,
      expect.objectContaining({ title: 'update the premium table' }),
    );
  });

  it('a clarify option runs its action with its text', async () => {
    const answer = holdIntake();
    const { result } = setup();
    act(() => result.current.send('the thing for andrea', send()));
    const options = [
      { label: 'The renewal call', action: 'ask' as const, text: 'What about the renewal call?' },
      { label: 'New note', action: 'note' as const, text: 'Note for Andrea' },
    ];
    await answer({
      items: [{ kind: 'clarify', question: 'The renewal call, or a new note?', options }],
      truncated: false,
    });
    expect(result.current.reply).toEqual({
      kind: 'clarify',
      question: 'The renewal call, or a new note?',
      options,
    });
    act(() => result.current.choose(options[1]!));
    await settle();
    expect(notesApi.create).toHaveBeenCalledWith(
      BOARD,
      expect.objectContaining({ title: 'Note for Andrea' }),
    );
  });

  it('processes messages one at a time, in order', async () => {
    const answer = holdIntake();
    const { result } = setup();
    act(() => {
      result.current.send('first', send());
      result.current.send('second', send());
    });
    expect(result.current.pending.map((p) => p.text)).toEqual(['first', 'second']);
    expect(assistantApi.intake).toHaveBeenCalledTimes(1);
    await answer({ items: [{ kind: 'note', text: 'first' }], truncated: false });
    expect(assistantApi.intake).toHaveBeenCalledTimes(2);
    expect(vi.mocked(assistantApi.intake).mock.calls[1]![1]).toMatchObject({ message: 'second' });
    await answer({ items: [{ kind: 'note', text: 'second' }], truncated: false });
    const titles = vi.mocked(notesApi.create).mock.calls.map(([, input]) => input.title);
    expect(titles).toEqual(['first', 'second']);
    expect(result.current.pending).toEqual([]);
  });

  it('falls back to one note as written', async () => {
    const answer = holdIntake();
    const { result } = setup();
    act(() => result.current.send('call irem wed', send()));
    await answer(new Error('504'));
    expect(notesApi.create).toHaveBeenCalledWith(
      BOARD,
      expect.objectContaining({ title: 'call irem wed' }),
    );
    expect(result.current.reply).toEqual({ kind: 'status', message: 'savedAsWritten' });
  });

  it('puts a failed question back', async () => {
    const answer = holdIntake();
    const { result, onRestoreText } = setup();
    act(() => result.current.send('what is blocking munich', send()));
    await answer(new Error('504'));
    expect(notesApi.create).not.toHaveBeenCalled();
    expect(onRestoreText).toHaveBeenCalledWith('what is blocking munich');
    expect(result.current.reply).toEqual({ kind: 'status', message: 'askFailed' });
  });

  it('ignores a reply for a closed box but still creates its notes', async () => {
    const answer = holdIntake();
    const { result, unmount } = setup();
    act(() => result.current.send('dentist thu', send()));
    unmount();
    await answer({ items: [{ kind: 'note', text: 'Dentist Thursday' }], truncated: false });
    expect(notesApi.create).toHaveBeenCalledWith(
      BOARD,
      expect.objectContaining({ title: 'Dentist Thursday' }),
    );
  });

  it('truncated shows the notice', async () => {
    const answer = holdIntake();
    const { result } = setup();
    act(() => result.current.send('many', send()));
    await answer({ items: [{ kind: 'note', text: 'one' }], truncated: true });
    expect(result.current.reply).toEqual({ kind: 'status', message: 'truncated' });
  });

  it('several notes at one free spot land one under another', async () => {
    const answer = holdIntake();
    const { result } = setup();
    act(() => result.current.send('a, b', send()));
    await answer({
      items: [
        { kind: 'note', text: 'A' },
        { kind: 'note', text: 'B' },
      ],
      truncated: false,
    });
    const [first, second] = vi.mocked(notesApi.create).mock.calls.map(([, input]) => input);
    expect(first).toMatchObject({ freeX: 100, freeY: 200 });
    expect(second!.freeX).toBe(100);
    expect(second!.freeY).toBeGreaterThan(200);
  });
});
