import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useLayoutEffect, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { DndContext } from '@dnd-kit/core';
import type { NoteDto, SuggestionDto } from '@wally/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  assistantApi: { suggest: vi.fn(), decide: vi.fn(), pendingSuggestions: vi.fn() },
}));
vi.mock('@/lib/preferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/preferences')>()),
  useWallybotPreferences: () => [{ autoApply: true }, vi.fn()] as const,
}));

import { assistantApi } from '@/lib/resources';
import { makeNote } from '@/test/fixtures';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { NoteCard } from '../WandView/NoteCard';
import { PendingReview } from '../NoteDetail/PendingReview';
import { COUNTDOWN_MS, useSuggestions, type SuggestionsController } from './useSuggestions';
import { usePendingFor } from './usePendingFor';

const BOARD = 'board-1';
const ME = 'user-1';
const NOTE_ID = 'note-1';

const dto = (over: Partial<SuggestionDto> = {}): SuggestionDto => ({
  id: 's1',
  boardId: BOARD,
  noteId: NOTE_ID,
  status: 'PENDING',
  baseRevision: 1,
  fields: {
    dueDate: { value: '2026-10-23', reason: 'Freitag' },
    priority: { value: 'HOCH', reason: 'dringend' },
    assignee: null,
    title: null,
    reference: null,
    subtasks: null,
  },
  typed: [],
  kept: null,
  createdAt: '2026-10-17T10:00:00.000Z',
  ...over,
});

const baseNote = (over: Partial<NoteDto> = {}) =>
  makeNote({
    id: NOTE_ID,
    revision: 1,
    dueDate: null,
    priority: 'MITTEL',
    assignee: null,
    customFields: {},
    subtaskSummary: { done: 0, total: 0 },
    ...over,
  });

let controller: SuggestionsController;
let takeTypedOff: (key: string) => void;

/**
 * The shell's wiring in small: one controller, the card on the board and, while the panel is
 * open, the review, both built by `usePendingFor`. The notes cache is the note's state here;
 * as in AppShell, `syncNotes` sees every version of it before paint. A typed row unticked does
 * what the panel's ordinary update does to the note: the value goes and the revision moves on.
 */
function Board({ openNoteId, initial }: { openNoteId: string | null; initial: NoteDto }) {
  const [note, setNote] = useState(initial);
  const suggestions = useSuggestions(BOARD, true, ME);
  controller = suggestions;
  const { syncNotes } = suggestions;
  useLayoutEffect(() => syncNotes([note]), [note, syncNotes]);
  const pendingFor = usePendingFor(suggestions, openNoteId);
  const pending = pendingFor(note.id);
  takeTypedOff = (key) =>
    setNote((n) => ({
      ...n,
      ...(key === 'dueDate' ? { dueDate: null } : {}),
      revision: n.revision + 1,
    }));
  return (
    <>
      <DndContext>
        <NoteCard
          note={note}
          currentUserId={ME}
          selected={openNoteId === note.id}
          onOpen={() => {}}
          pending={pending}
        />
      </DndContext>
      {openNoteId === note.id && pending && pending.mark.phase !== 'asking' && (
        <PendingReview note={note} pending={pending} onTypedChange={(key) => takeTypedOff(key)} />
      )}
    </>
  );
}

function setup(initial = baseNote()) {
  const queryClient = createTestQueryClient();
  const ui = (openNoteId: string | null) => (
    <QueryClientProvider client={queryClient}>
      <Board openNoteId={openNoteId} initial={initial} />
    </QueryClientProvider>
  );
  const utils = render(ui(null));
  return {
    ...utils,
    open: () => utils.rerender(ui(NOTE_ID)),
    close: () => utils.rerender(ui(null)),
  };
}

const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
/** Asks for a change after a commit and waits for the answer: a countdown starts. */
const propose = async () => {
  act(() => controller.request(NOTE_ID, []));
  await advance(0);
};
const mark = () => controller.marks.get(NOTE_ID);
const card = () => document.querySelector<HTMLElement>('[data-note-id]')!;
const cardButton = () => within(card()).getByText('Angebotsvergleich freigeben').closest('button')!;
const review = () => document.querySelector<HTMLElement>('[data-pending-review]');
const keeps = () =>
  vi.mocked(assistantApi.decide).mock.calls.filter(([, , body]) => body.decision === 'keep');

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.mocked(assistantApi.pendingSuggestions).mockResolvedValue({ suggestions: [] });
  vi.mocked(assistantApi.suggest).mockResolvedValue({ suggestion: dto() });
  vi.mocked(assistantApi.decide).mockImplementation(async (_b, id, body) => ({
    suggestion: dto({
      id,
      status: body.decision === 'keep' ? 'KEPT' : body.decision === 'undo' ? 'UNDONE' : 'DISCARDED',
      kept:
        body.decision === 'keep'
          ? { fields: body.fields ?? [], subtasks: body.subtasks ?? [], revision: 2 }
          : null,
    }),
  }));
});
afterEach(() => vi.useRealTimers());

describe('the panel holds the countdown of the note it shows (R3)', () => {
  it('pauses while the panel is open and resumes where it was once it closes', async () => {
    const { open, close } = setup();
    await propose();
    expect(mark()?.countdownEndsAt).not.toBeNull();
    await advance(2000);

    open();
    expect(mark()?.paused).toBe(true);
    expect(mark()?.countdownEndsAt).toBeNull();
    expect(within(review()!).getByRole('status')).toHaveTextContent('Wird gleich übernommen');
    // Far past the countdown: nothing is kept while the review is open.
    await advance(COUNTDOWN_MS * 5);
    expect(keeps()).toHaveLength(0);

    close();
    expect(mark()?.paused).toBe(false);
    await advance(COUNTDOWN_MS - 2000 - 1);
    expect(keeps()).toHaveLength(0);
    await advance(1);
    expect(keeps()).toEqual([
      [BOARD, 's1', { decision: 'keep', fields: ['dueDate', 'priority'], source: 'countdown' }],
    ]);
  });

  it('stays paused when the pointer leaves the card for the panel', async () => {
    const { open, close } = setup();
    await propose();
    // The click that opens the panel comes from a pointer already on the card.
    fireEvent.mouseEnter(cardButton());
    expect(mark()?.paused).toBe(true);
    open();
    fireEvent.mouseLeave(cardButton());
    expect(mark()?.paused).toBe(true);
    await advance(COUNTDOWN_MS * 5);
    expect(keeps()).toHaveLength(0);

    close();
    expect(mark()?.paused).toBe(false);
    await advance(COUNTDOWN_MS);
    expect(keeps()).toHaveLength(1);
  });

  it('stays paused when the panel closes with the pointer still on the card', async () => {
    const { open, close } = setup();
    await propose();
    fireEvent.mouseEnter(cardButton());
    open();
    close();
    expect(mark()?.paused).toBe(true);
    await advance(COUNTDOWN_MS * 5);
    expect(keeps()).toHaveLength(0);

    fireEvent.mouseLeave(cardButton());
    expect(mark()?.paused).toBe(false);
    await advance(COUNTDOWN_MS);
    expect(keeps()).toHaveLength(1);
  });

  it('leaves the hover pause alone while the panel is closed', async () => {
    setup();
    await propose();
    fireEvent.mouseEnter(cardButton());
    expect(mark()?.paused).toBe(true);
    fireEvent.mouseLeave(cardButton());
    expect(mark()?.paused).toBe(false);
  });
});

describe('the card and the review read one mark (§3.4)', () => {
  const full = () =>
    dto({
      fields: {
        dueDate: { value: '2026-10-23', reason: 'Freitag' },
        priority: { value: 'HOCH', reason: 'dringend' },
        assignee: null,
        title: { value: 'Angebot an Müller', reason: 'kürzer' },
        reference: { key: 'Kunde', value: 'Müller GmbH', reason: 'Müller' },
        subtasks: { items: ['Preise holen', 'Vergleichen', 'Freigeben'], reason: 'Ablauf' },
      },
    });
  const row = (name: string | RegExp) =>
    within(screen.getByRole('group', { name: 'Von Wallybot ergänzt' })).getByRole('checkbox', {
      name,
    });

  it('follows every tick in the review, and the review follows the card', async () => {
    vi.mocked(assistantApi.suggest).mockResolvedValue({ suggestion: full() });
    const { open } = setup();
    await propose();
    open();

    expect(card().querySelector('.border-dashed')).not.toBeNull();
    expect(within(card()).getByText('Kunde: Müller GmbH')).toBeInTheDocument();
    expect(within(card()).getByText('3 Schritte')).toBeInTheDocument();
    expect(within(card()).getByText(/Fr\.?,? 23\.10\./)).toBeInTheDocument();
    const titleLine = within(card()).getByRole('button', { name: 'Vorschlag: Angebot an Müller' });
    expect(titleLine).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(row('Kunde: Müller GmbH'));
    expect(within(card()).queryByText('Kunde: Müller GmbH')).toBeNull();
    expect(row('Kunde: Müller GmbH')).not.toBeChecked();

    fireEvent.click(row('Schritt: Vergleichen'));
    expect(within(card()).getByText('2 Schritte')).toBeInTheDocument();

    fireEvent.click(row(/^Vorschlag: Angebot an Müller/));
    expect(
      within(card()).getByRole('button', { name: 'Vorschlag: Angebot an Müller' }),
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(row('Priorität hoch'));
    expect(
      within(card()).queryByRole('button', { name: 'Vorschlag entfernen: Priorität hoch' }),
    ).toBeNull();

    // The other way round: the card's × unticks the review's row.
    fireEvent.click(within(card()).getByRole('button', { name: /^Vorschlag entfernen: Fällig / }));
    expect(row(/^Fällig /)).not.toBeChecked();
    fireEvent.click(row(/^Fällig /));
    expect(within(card()).getByText(/Fr\.?,? 23\.10\./)).toBeInTheDocument();

    // Keep sends exactly what is ticked in both places.
    fireEvent.click(within(review()!).getByRole('button', { name: 'Behalten' }));
    await advance(0);
    expect(keeps()).toEqual([
      [
        BOARD,
        's1',
        {
          decision: 'keep',
          fields: ['dueDate', 'title', 'subtasks'],
          subtasks: [0, 2],
          source: 'enter',
        },
      ],
    ]);
    expect(within(review()!).getByRole('status')).toHaveTextContent('Übernommen.');
    expect(card().querySelector('.border-dashed')).toBeNull();
  });

  /*
   * Plan R4 as written: a typed row unticked takes the value off the note through the ordinary
   * update. That update moves the note past the revision the change was proposed for, a keep
   * would be refused (409 STALE_REVISION), so the controller forgets the change: the review and
   * the card's dashed edge go together, and nothing is said. Recorded here so a ruling that
   * changes it changes this test.
   */
  it('ends the whole change when a typed row is unticked (R4 against the stale rule)', async () => {
    vi.mocked(assistantApi.suggest).mockResolvedValue({
      suggestion: dto({
        typed: ['dueDate'],
        fields: { ...dto().fields, dueDate: null },
      }),
    });
    const { open } = setup(baseNote({ dueDate: '2026-10-30' }));
    await propose();
    open();
    expect(card().querySelector('.border-dashed')).not.toBeNull();

    fireEvent.click(
      within(screen.getByRole('group', { name: 'Aus deinem Text' })).getByRole('checkbox', {
        name: /^Fällig /,
      }),
    );
    await advance(0);
    expect(mark()).toBeUndefined();
    expect(review()).toBeNull();
    expect(card().querySelector('.border-dashed')).toBeNull();
    // No decision is sent: the server finds the record stale on its own next read.
    expect(assistantApi.decide).not.toHaveBeenCalled();
  });
});
