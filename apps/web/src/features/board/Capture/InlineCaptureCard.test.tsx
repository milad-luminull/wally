import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NoteDto, NoteVisibility } from '@wally/shared';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  notesApi: {
    create: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    assign: vi.fn(),
    remove: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
  },
  membersApi: { list: vi.fn() },
}));
vi.mock('@/i18n/LanguageProvider', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/LanguageProvider')>('@/i18n/LanguageProvider');
  return {
    ...actual,
    useLanguage: () => ({
      language: 'de',
      setLanguage: vi.fn(),
      isSaving: false,
      saveFailed: false,
    }),
  };
});

import { membersApi, notesApi } from '@/lib/resources';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { useKeyboardShortcuts } from '@/lib/shortcuts';
import { InlineCaptureCard } from './InlineCaptureCard';
import { DRAFT_SAVE_MS } from './useCapture';

const created = (overrides: Partial<NoteDto> = {}) =>
  makeNote({ id: 'n-new', revision: 1, title: 'Müller anrufen', ...overrides });

function renderCard(layout: 'card' | 'row' = 'card', visibility: NoteVisibility = 'SHARED') {
  const onDone = vi.fn();
  const view = renderWithProviders(
    <InlineCaptureCard
      boardId="b1"
      placement={{ kind: 'free', x: 10, y: 20 }}
      visibility={visibility}
      layout={layout}
      onDone={onDone}
    />,
  );
  return { onDone, unmount: view.unmount };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The board's own shortcut hook, as the board binds it: N opens a capture, Esc closes. */
function BoardKeys({ onN, onEsc }: { onN: () => void; onEsc: () => void }) {
  useKeyboardShortcuts([
    { keys: 'n', handler: onN },
    { keys: 'escape', handler: onEsc, allowInInputs: true },
  ]);
  return null;
}

describe('InlineCaptureCard', () => {
  beforeEach(() => {
    vi.mocked(notesApi.create).mockReset().mockResolvedValue(created());
    vi.mocked(notesApi.update)
      .mockReset()
      .mockImplementation(async (_id, input) =>
        created({ ...(input as object) } as Partial<NoteDto>),
      );
    vi.mocked(notesApi.move)
      .mockReset()
      .mockResolvedValue(created({ priority: 'HOCH' }));
    vi.mocked(notesApi.assign).mockReset().mockResolvedValue(created());
    vi.mocked(notesApi.remove).mockReset().mockResolvedValue(undefined);
    vi.mocked(membersApi.list)
      .mockReset()
      .mockResolvedValue([
        {
          id: 'm1',
          userId: 'u-anna',
          email: 'anna@example.com',
          displayName: 'Anna Kowalski',
          role: 'EDIT',
          status: 'ACTIVE',
        },
      ]);
  });

  it('focuses the title and creates nothing until the first keystroke', async () => {
    const { onDone } = renderCard();
    const title = screen.getByRole('textbox', { name: 'Titel der neuen Notiz' });
    expect(title).toHaveFocus();
    expect(notesApi.create).not.toHaveBeenCalled();
    await userEvent.setup().keyboard('{Escape}');
    expect(notesApi.create).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(null, false);
  });

  it('creates the note on the first keystroke with the placement and visibility', async () => {
    renderCard();
    await userEvent
      .setup()
      .type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'M');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(notesApi.create).mock.calls[0]![1]).toMatchObject({
      title: 'M',
      freeX: 10,
      freeY: 20,
      visibility: 'SHARED',
    });
  });

  it('commits on Enter with the title and the kept chips, then reports the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'Müller anrufen Freitag @anna dringend',
    );
    expect(screen.getByRole('button', { name: /Fällig/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zuständig: Anna Kowalski' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Priorität hoch' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false));
    const update = vi.mocked(notesApi.update).mock.calls.at(-1)!;
    expect(update[0]).toBe('n-new');
    expect(update[1]).toMatchObject({ title: 'Müller anrufen Freitag @anna dringend' });
    expect((update[1] as { dueDate?: string }).dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // noteUpdateSchema is strict and has no priority; a priority change is a PRIORITY move.
    expect(update[1]).not.toHaveProperty('priority');
    expect(notesApi.move).toHaveBeenCalledWith(
      'n-new',
      { mode: 'PRIORITY', priority: 'HOCH' },
      expect.anything(),
    );
    expect(notesApi.assign).toHaveBeenCalledWith('n-new', 'u-anna', expect.anything());
  });

  it('removing a chip keeps that field out of the commit', async () => {
    renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Titel der neuen Notiz' });
    await user.type(title, 'Müller anrufen Freitag @anna');
    const chip = document.querySelector<HTMLElement>('[data-chip="assignee"]')!;
    await user.click(within(chip).getByRole('button', { name: 'Vorschlag entfernen' }));
    expect(screen.queryByRole('button', { name: 'Zuständig: Anna Kowalski' })).toBeNull();
    expect(title).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
    expect(notesApi.assign).not.toHaveBeenCalled();
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).not.toHaveProperty('assigneeId');
  });

  it('a tapped chip is set aside and its field stays out of the commit', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'Angebot dringend',
    );
    const chip = screen.getByRole('button', { name: 'Priorität hoch' });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    await user.click(chip);
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false));
    expect(notesApi.move).not.toHaveBeenCalled();
  });

  it('Shift+Enter opens the text line, Enter from there commits with the description', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Angebot');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    const text = await screen.findByRole('textbox', { name: 'Text der neuen Notiz' });
    expect(text).toHaveFocus();
    await user.type(text, 'drei Varianten{Enter}');
    await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({
      title: 'Angebot',
      description: 'drei Varianten',
    });
  });

  it('does not commit a whitespace title on Enter and deletes the note on blur', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Titel der neuen Notiz' });
    await user.type(title, 'a{Backspace} ');
    await user.keyboard('{Enter}');
    expect(onDone).not.toHaveBeenCalled();
    expect(title).toBeInTheDocument();
    await user.tab();
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('n-new', expect.anything()));
    expect(onDone).toHaveBeenCalledWith(null, false);
  });

  it('blur with a title commits the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Bleibt');
    await user.tab();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false));
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({ title: 'Bleibt' });
    expect(notesApi.remove).not.toHaveBeenCalled();
  });

  it('Esc after typing deletes the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Weg');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('n-new', expect.anything()));
    expect(onDone).toHaveBeenCalledWith(null, false);
    expect(notesApi.update).not.toHaveBeenCalled();
  });

  it('commits with Cmd+Enter and asks to open the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Details');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', true));
  });

  it('underlines the matched words in the field', async () => {
    renderCard();
    await userEvent
      .setup()
      .type(
        screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
        'Müller anrufen Freitag',
      );
    const marks = screen.getAllByTestId('capture-mark');
    expect(marks.map((m) => m.textContent)).toEqual(['Freitag']);
  });

  it('renders as a full-width row in the list layout', () => {
    renderCard('row');
    expect(screen.getByRole('group', { name: 'Neue Notiz schreiben' })).toHaveAttribute(
      'data-layout',
      'row',
    );
  });

  it('grows from its top-left corner, where the person clicked', () => {
    renderCard();
    const card = screen.getByRole('group', { name: 'Neue Notiz schreiben' });
    expect(card).toHaveClass('animate-capture-in', 'origin-top-left');
  });

  it('a private capture proposes no person and commits without an assignment', async () => {
    const { onDone } = renderCard('card', 'PRIVATE');
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'Müller anrufen @anna dringend',
    );
    expect(vi.mocked(notesApi.create).mock.calls[0]![1]).toMatchObject({ visibility: 'PRIVATE' });
    // The API answers any other assignee of a private note with PRIVATE_NOTE_NOT_ASSIGNABLE.
    expect(screen.queryByRole('button', { name: /Zuständig/ })).toBeNull();
    expect(screen.getAllByTestId('capture-mark').map((m) => m.textContent)).toEqual(['dringend']);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false));
    expect(notesApi.assign).not.toHaveBeenCalled();
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({
      title: 'Müller anrufen @anna dringend',
    });
  });

  it('saves the words typed so far while typing pauses, before any commit', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Müller anr');
    await waitFor(
      () =>
        expect(notesApi.update).toHaveBeenCalledWith(
          'n-new',
          { title: 'Müller anr', description: '' },
          expect.anything(),
        ),
      { timeout: DRAFT_SAVE_MS * 4 },
    );
    // Words only: no chip is applied before Enter, and the capture is still open.
    expect(notesApi.update).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
  });

  it('does not save a title erased back to nothing', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'ab{Backspace}{Backspace}',
    );
    await pause(DRAFT_SAVE_MS * 2);
    expect(notesApi.update).not.toHaveBeenCalled();
  });

  it('keeps the words when the card is taken away before the pause', async () => {
    const { unmount } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Halb');
    unmount();
    await waitFor(() =>
      expect(notesApi.update).toHaveBeenCalledWith(
        'n-new',
        { title: 'Halb', description: '' },
        expect.anything(),
      ),
    );
  });

  it('the board shortcuts never see a key the capture handles', async () => {
    const onN = vi.fn();
    const onEsc = vi.fn();
    const seen: string[] = [];
    const record = (event: KeyboardEvent) => seen.push(event.key);
    document.addEventListener('keydown', record);
    try {
      const onDone = vi.fn();
      renderWithProviders(
        <>
          <BoardKeys onN={onN} onEsc={onEsc} />
          <InlineCaptureCard
            boardId="b1"
            placement={{ kind: 'free', x: 10, y: 20 }}
            visibility="SHARED"
            layout="card"
            onDone={onDone}
          />
        </>,
      );
      const user = userEvent.setup();
      await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Notiz');
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(onDone).toHaveBeenCalledWith(null, false));
      // The `n` typed into the title stays an `n`; Enter and Esc stop at the capture.
      expect(onN).not.toHaveBeenCalled();
      expect(onEsc).not.toHaveBeenCalled();
      expect(seen).not.toContain('Escape');
      expect(seen).not.toContain('Enter');
    } finally {
      document.removeEventListener('keydown', record);
    }
  });

  it('a failed commit keeps the card, the words and the caret, and Enter retries', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Titel der neuen Notiz' });
    await user.type(title, 'Nochmal');
    vi.mocked(notesApi.update).mockRejectedValueOnce(new Error('offline'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(notesApi.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(title).not.toHaveAttribute('aria-busy', 'true'));
    expect(onDone).not.toHaveBeenCalled();
    expect(title).toHaveValue('Nochmal');
    expect(title).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false));
  });
});
