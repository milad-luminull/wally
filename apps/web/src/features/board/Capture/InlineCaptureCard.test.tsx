import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
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
// No LanguageProvider here (it would fetch /me); useLanguage answers what the provider would,
// the active i18n language (LanguageProvider keeps the two equal). The card parses in that
// language, so the suite's English cases read English and the German cases, marked below,
// switch the whole card to German with `inGerman()`: German words, German copy.
vi.mock('@/i18n/LanguageProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/LanguageProvider')>();
  const { i18n } = await import('@/i18n');
  const { FALLBACK_LOCALE, normalizeLocale } = await import('@/i18n/locales');
  return {
    ...actual,
    useLanguage: () => ({
      language: normalizeLocale(i18n.language) ?? FALLBACK_LOCALE,
      setLanguage: vi.fn(),
      isSaving: false,
      saveFailed: false,
    }),
  };
});

import { i18n } from '@/i18n';
import { membersApi, notesApi } from '@/lib/resources';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { useKeyboardShortcuts } from '@/lib/shortcuts';
import { AskCard } from '../Ask/AskCard';
import { InlineCaptureCard } from './InlineCaptureCard';
import { DRAFT_SAVE_MS, type CapturePlacement } from './useCapture';

const created = (overrides: Partial<NoteDto> = {}) =>
  makeNote({ id: 'n-new', revision: 1, title: 'Call Müller', ...overrides });

function renderCard(
  layout: 'card' | 'row' = 'card',
  visibility: NoteVisibility = 'SHARED',
  placement: CapturePlacement = { kind: 'free', x: 10, y: 20 },
) {
  const onDone = vi.fn();
  const view = renderWithProviders(
    <InlineCaptureCard
      boardId="b1"
      placement={placement}
      visibility={visibility}
      layout={layout}
      onDone={onDone}
    />,
  );
  return { onDone, unmount: view.unmount };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A German person's card: the parser reads German and the copy is German, as in the app.
 * Awaited before render; src/test/setup.ts switches back to English after each test.
 */
const inGerman = () => i18n.changeLanguage('de');

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
    const title = screen.getByRole('textbox', { name: 'Title of the new note' });
    expect(title).toHaveFocus();
    expect(notesApi.create).not.toHaveBeenCalled();
    await userEvent.setup().keyboard('{Escape}');
    expect(notesApi.create).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledWith(null, false, []);
  });

  it('creates the note on the first keystroke with the placement and visibility', async () => {
    renderCard();
    await userEvent
      .setup()
      .type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'M');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(notesApi.create).mock.calls[0]![1]).toMatchObject({
      title: 'M',
      freeX: 10,
      freeY: 20,
      visibility: 'SHARED',
    });
  });

  it('commits on Enter with the title and the kept chips, then reports the note', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'Müller anrufen Freitag @anna dringend',
    );
    expect(screen.getByRole('button', { name: /^Fällig/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zuständig: Anna Kowalski' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Priorität hoch' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('n-new', false, ['dueDate', 'priority', 'assignee']),
    );
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
    // German input through a German card: the parser reads the person's language.
    await inGerman();
    renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Titel der neuen Notiz' });
    await user.type(title, 'Müller anrufen Freitag @anna');
    const chip = document.querySelector<HTMLElement>('[data-chip="assignee"]')!;
    await user.click(
      within(chip).getByRole('button', {
        name: 'Vorschlag entfernen: Zuständig: Anna Kowalski',
      }),
    );
    expect(screen.queryByRole('button', { name: 'Zuständig: Anna Kowalski' })).toBeNull();
    expect(title).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
    expect(notesApi.assign).not.toHaveBeenCalled();
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).not.toHaveProperty('assigneeId');
  });

  it('a tapped chip is set aside and its field stays out of the commit', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
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
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
    expect(notesApi.move).not.toHaveBeenCalled();
  });

  it('Shift+Enter opens the text line, Enter from there commits with the description', async () => {
    renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Quote');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    const text = await screen.findByRole('textbox', { name: 'Text of the new note' });
    expect(text).toHaveFocus();
    await user.type(text, 'three options{Enter}');
    await waitFor(() => expect(notesApi.update).toHaveBeenCalled());
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({
      title: 'Quote',
      description: 'three options',
    });
  });

  it('does not commit whitespace in both fields on Enter and deletes the note on blur', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Title of the new note' });
    await user.type(title, 'a{Backspace} ');
    await user.keyboard('{Enter}');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    const text = await screen.findByRole('textbox', { name: 'Text of the new note' });
    await user.type(text, '  {Enter}');
    expect(onDone).not.toHaveBeenCalled();
    expect(notesApi.update).not.toHaveBeenCalled();
    expect(title).toBeInTheDocument();
    await user.tab();
    await user.tab();
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('n-new', expect.anything()));
    expect(onDone).toHaveBeenCalledWith(null, false, []);
  });

  it('blur with a title commits the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Stays');
    await user.tab();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({ title: 'Stays' });
    expect(notesApi.remove).not.toHaveBeenCalled();
  });

  it('a note started in the text line commits with an empty title and that text', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    const text = await screen.findByRole('textbox', { name: 'Text of the new note' });
    await user.type(text, 'just text');
    await waitFor(() => expect(notesApi.create).toHaveBeenCalledTimes(1));
    expect(vi.mocked(notesApi.create).mock.calls[0]![1]).toMatchObject({ title: '' });
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({
      title: '',
      description: 'just text',
    });
    expect(notesApi.remove).not.toHaveBeenCalled();
  });

  it('a click elsewhere with nothing typed sends no request', async () => {
    const { onDone } = renderCard();
    await userEvent.setup().tab();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null, false, []));
    expect(notesApi.create).not.toHaveBeenCalled();
    expect(notesApi.remove).not.toHaveBeenCalled();
    expect(notesApi.update).not.toHaveBeenCalled();
  });

  it('a click on the card outside its fields keeps the caret and settles nothing', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Title of the new note' });
    await user.type(title, 'Hold');
    await user.click(screen.getByText('↵ create · ⇧↵ text · Esc discard'));
    await pause(20);
    expect(title).toHaveFocus();
    expect(onDone).not.toHaveBeenCalled();
    expect(notesApi.remove).not.toHaveBeenCalled();
  });

  describe('in a priority zone', () => {
    const priorityZone: CapturePlacement = {
      kind: 'zone',
      axis: 'priority',
      key: 'MITTEL',
      at: { freeX: 0, freeY: 0 },
    };

    it('proposes the priority but leaves the note where it was placed', async () => {
      // German input through a German card: the parser reads the person's language.
      await inGerman();
      const { onDone } = renderCard('card', 'SHARED', priorityZone);
      const user = userEvent.setup();
      await user.type(
        screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
        'Bericht dringend',
      );
      expect(screen.getByRole('button', { name: 'Priorität hoch' })).toHaveAttribute(
        'aria-pressed',
        'false',
      );
      await user.keyboard('{Enter}');
      await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, ['priority']));
      expect(notesApi.move).not.toHaveBeenCalled();
    });

    it('moves the note when the person keeps the priority chip', async () => {
      // German input through a German card: the parser reads the person's language.
      await inGerman();
      const { onDone } = renderCard('card', 'SHARED', priorityZone);
      const user = userEvent.setup();
      await user.type(
        screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
        'Bericht dringend',
      );
      await user.click(screen.getByRole('button', { name: 'Priorität hoch' }));
      await user.keyboard('{Enter}');
      await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, ['priority']));
      expect(notesApi.move).toHaveBeenCalledWith(
        'n-new',
        { mode: 'PRIORITY', priority: 'HOCH' },
        expect.anything(),
      );
    });

    it('hands over the priority as decided by the placement, with no chip at all', async () => {
      const { onDone } = renderCard('card', 'SHARED', priorityZone);
      const user = userEvent.setup();
      await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Report');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, ['priority']));
    });
  });

  it('a plain title in a horizon zone hands over no decided field', async () => {
    const { onDone } = renderCard('card', 'SHARED', {
      kind: 'zone',
      axis: 'horizon',
      key: 'HEUTE',
      at: { freeX: 0, freeY: 0 },
    });
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Report');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
  });

  it('Esc after typing deletes the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Gone');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('n-new', expect.anything()));
    expect(onDone).toHaveBeenCalledWith(null, false, []);
    expect(notesApi.update).not.toHaveBeenCalled();
  });

  it('commits with Cmd+Enter and asks to open the note', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Details');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', true, []));
  });

  it('underlines every matched word in the field, in text order', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
    renderCard();
    await userEvent
      .setup()
      .type(
        screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
        'Müller anrufen Freitag @anna dringend',
      );
    const marks = screen.getAllByTestId('capture-mark');
    expect(marks.map((m) => m.textContent)).toEqual(['Freitag', '@anna', 'dringend']);
  });

  it('a person alone is the only field reported as decided here, never a Wallybot-only field', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Title of the new note' }),
      'Call Müller @anna',
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, ['assignee']));
  });

  it('commits the date and the priority but not a dropped person', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'Müller anrufen Freitag @anna dringend',
    );
    await user.click(
      screen.getByRole('button', { name: 'Vorschlag entfernen: Zuständig: Anna Kowalski' }),
    );
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('n-new', false, ['dueDate', 'priority']),
    );
    expect(
      (vi.mocked(notesApi.update).mock.calls.at(-1)![1] as { dueDate?: string }).dueDate,
    ).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(notesApi.move).toHaveBeenCalledWith(
      'n-new',
      { mode: 'PRIORITY', priority: 'HOCH' },
      expect.anything(),
    );
    expect(notesApi.assign).not.toHaveBeenCalled();
  });

  it('names each chip and its × after the suggestion it stands for', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
    renderCard();
    await userEvent
      .setup()
      .type(
        screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
        'Müller anrufen Freitag @anna dringend',
      );
    const removes = screen
      .getAllByRole('button', { name: /^Vorschlag entfernen/ })
      .map((b) => b.getAttribute('aria-label'));
    expect(removes).toEqual([
      expect.stringMatching(/^Vorschlag entfernen: Fällig /),
      'Vorschlag entfernen: Zuständig: Anna Kowalski',
      'Vorschlag entfernen: Priorität hoch',
    ]);
  });

  it('renders as a full-width row in the list layout', () => {
    renderCard('row');
    expect(screen.getByRole('group', { name: 'Write a new note' })).toHaveAttribute(
      'data-layout',
      'row',
    );
  });

  it('grows from its top-left corner, where the person clicked', () => {
    renderCard();
    const card = screen.getByRole('group', { name: 'Write a new note' });
    expect(card).toHaveClass('animate-capture-in', 'origin-top-left');
  });

  it('a private capture proposes no person and commits without an assignment', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
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
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, ['priority']));
    expect(notesApi.assign).not.toHaveBeenCalled();
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({
      title: 'Müller anrufen @anna dringend',
    });
  });

  it('saves the words typed so far while typing pauses, before any commit', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Call Mül');
    await waitFor(
      () =>
        expect(notesApi.update).toHaveBeenCalledWith(
          'n-new',
          { title: 'Call Mül', description: '' },
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
      screen.getByRole('textbox', { name: 'Title of the new note' }),
      'ab{Backspace}{Backspace}',
    );
    await pause(DRAFT_SAVE_MS * 2);
    expect(notesApi.update).not.toHaveBeenCalled();
  });

  it('keeps the words when the card is taken away before the pause', async () => {
    const { unmount } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Half');
    unmount();
    await waitFor(() =>
      expect(notesApi.update).toHaveBeenCalledWith(
        'n-new',
        { title: 'Half', description: '' },
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
      await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Note');
      await user.keyboard('{Shift>}{Enter}{/Shift}');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(onDone).toHaveBeenCalledWith(null, false, []));
      // The `n` typed into the title stays an `n`; Enter and Esc stop at the capture.
      expect(onN).not.toHaveBeenCalled();
      expect(onEsc).not.toHaveBeenCalled();
      expect(seen).not.toContain('Escape');
      expect(seen).not.toContain('Enter');
    } finally {
      document.removeEventListener('keydown', record);
    }
  });

  it('stays read-only for the whole commit when the create resolves after Enter', async () => {
    let resolveCreate: (note: NoteDto) => void = () => {};
    vi.mocked(notesApi.create).mockImplementationOnce(
      () => new Promise((resolve) => (resolveCreate = resolve)),
    );
    let resolveUpdate: (note: NoteDto) => void = () => {};
    vi.mocked(notesApi.update).mockImplementationOnce(
      () => new Promise((resolve) => (resolveUpdate = resolve)),
    );
    const { onDone } = renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Title of the new note' });
    await user.type(title, 'Late');
    await user.keyboard('{Enter}');
    expect(title).toHaveAttribute('readonly');
    await act(async () => resolveCreate(created({ title: 'Late' })));
    await waitFor(() => expect(notesApi.update).toHaveBeenCalledTimes(1));
    // The create landed mid-commit; the commit is still waiting on its update.
    expect(title).toHaveAttribute('readonly');
    await act(async () => resolveUpdate(created({ title: 'Late' })));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
  });

  it('Shift+Enter in the title goes back to a text line that is already open', async () => {
    renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Title of the new note' });
    await user.type(title, 'Quote');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    const text = await screen.findByRole('textbox', { name: 'Text of the new note' });
    await user.type(text, 'three');
    await user.click(title);
    expect(title).toHaveFocus();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(text).toHaveFocus();
  });

  it('saves the text as typed, without trimming it', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Title of the new note' }), 'Quote');
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    const text = await screen.findByRole('textbox', { name: 'Text of the new note' });
    await user.type(text, '  three options  {Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
    expect(vi.mocked(notesApi.update).mock.calls.at(-1)![1]).toMatchObject({
      title: 'Quote',
      description: '  three options  ',
    });
  });

  it('stops underlining a match once its chip is dropped', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
    renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }),
      'Müller anrufen Freitag @anna',
    );
    expect(screen.getAllByTestId('capture-mark').map((m) => m.textContent)).toEqual([
      'Freitag',
      '@anna',
    ]);
    await user.click(
      screen.getByRole('button', { name: 'Vorschlag entfernen: Zuständig: Anna Kowalski' }),
    );
    expect(screen.getAllByTestId('capture-mark').map((m) => m.textContent)).toEqual(['Freitag']);
  });

  it('formats the proposed date in the language the line was read in', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
    renderCard();
    await userEvent
      .setup()
      .type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Bericht Freitag');
    // German order and weekday (`Fr., 16.10.`), not English (`Fri, 10/16`).
    expect(screen.getByRole('button', { name: /^Fällig / })).toHaveAccessibleName(
      /^Fällig Fr\., \d{2}\.\d{2}\.$/,
    );
  });

  it('reads an English line on an English card: Friday, @anna and urgent become chips', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Title of the new note' }),
      'Call Müller Friday @anna urgent',
    );
    expect(screen.getAllByTestId('capture-mark').map((m) => m.textContent)).toEqual([
      'Friday',
      '@anna',
      'urgent',
    ]);
    // English order and weekday (`Fri, 10/16`).
    expect(screen.getByRole('button', { name: /^Due / })).toHaveAccessibleName(
      /^Due Fri, \d{2}\/\d{2}$/,
    );
    expect(screen.getByRole('button', { name: 'Assigned to Anna Kowalski' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'High priority' })).toBeInTheDocument();
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith('n-new', false, ['dueDate', 'priority', 'assignee']),
    );
  });

  it('describes the title field with the keyboard hint, set in the mono face', () => {
    renderCard();
    const title = screen.getByRole('textbox', { name: 'Title of the new note' });
    expect(title).toHaveAccessibleDescription('↵ create · ⇧↵ text · Esc discard');
    expect(screen.getByText('↵ create · ⇧↵ text · Esc discard')).toHaveClass('font-mono');
  });

  it('owns its keys while a chip has focus: n is no new note, Esc discards', async () => {
    // German input through a German card: the parser reads the person's language.
    await inGerman();
    const onN = vi.fn();
    const onEsc = vi.fn();
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
    await user.type(screen.getByRole('textbox', { name: 'Titel der neuen Notiz' }), 'Freitag');
    await user.tab();
    expect(screen.getByRole('button', { name: /^Fällig/ })).toHaveFocus();
    await user.keyboard('n');
    expect(onN).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null, false, []));
    expect(onEsc).not.toHaveBeenCalled();
  });

  it('a failed commit keeps the card, the words and the caret, and Enter retries', async () => {
    const { onDone } = renderCard();
    const user = userEvent.setup();
    const title = screen.getByRole('textbox', { name: 'Title of the new note' });
    await user.type(title, 'Again');
    vi.mocked(notesApi.update).mockRejectedValueOnce(new Error('offline'));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(notesApi.update).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(title).not.toHaveAttribute('aria-busy', 'true'));
    expect(onDone).not.toHaveBeenCalled();
    expect(title).toHaveValue('Again');
    expect(title).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
  });

  describe('a question', () => {
    function renderAsking(onAsk = vi.fn(), onDone = vi.fn()) {
      renderWithProviders(
        <InlineCaptureCard
          boardId="b1"
          placement={{ kind: 'free', x: 10, y: 20 }}
          visibility="SHARED"
          layout="card"
          onDone={onDone}
          onAsk={onAsk}
        />,
      );
      return { onAsk, onDone, title: screen.getByLabelText('Title of the new note') };
    }

    it('says that Enter asks once the title ends in a question mark', async () => {
      const { title } = renderAsking();
      await userEvent.type(title, 'What is open today');
      expect(screen.getByText('↵ create · ⇧↵ text · Esc discard')).toBeInTheDocument();
      await userEvent.type(title, '?');
      expect(screen.getByText('↵ asks the wall · ⇧↵ text · Esc discard')).toBeInTheDocument();
      expect(screen.queryByText('↵ create · ⇧↵ text · Esc discard')).not.toBeInTheDocument();
    });

    it('Enter on a question hands it over, deletes the draft note and ends the capture with no note', async () => {
      const { onAsk, onDone, title } = renderAsking();
      await userEvent.type(title, 'What is open today?{Enter}');
      await waitFor(() =>
        expect(onAsk).toHaveBeenCalledWith('What is open today?', { takeFocus: true }),
      );
      await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('n-new', expect.anything()));
      expect(onDone).toHaveBeenCalledWith(null, false, []);
      expect(notesApi.move).not.toHaveBeenCalled();
      expect(notesApi.assign).not.toHaveBeenCalled();
    });

    it('carries the text line with the question', async () => {
      const { onAsk, title } = renderAsking();
      await userEvent.type(title, 'Which are overdue?{Shift>}{Enter}{/Shift}');
      await userEvent.type(screen.getByLabelText('Text of the new note'), 'Only mine{Enter}');
      await waitFor(() =>
        expect(onAsk).toHaveBeenCalledWith('Which are overdue?\n\nOnly mine', {
          takeFocus: true,
        }),
      );
    });

    it('a blur on a question asks it too, and the answer does not take the focus', async () => {
      const { onAsk, title } = renderAsking();
      await userEvent.type(title, 'What is late?');
      await userEvent.tab();
      await waitFor(() =>
        expect(onAsk).toHaveBeenCalledWith('What is late?', { takeFocus: false }),
      );
    });

    it('without asking on, a question mark is a plain title and the hint does not change', async () => {
      const { onDone } = renderCard();
      const title = screen.getByLabelText('Title of the new note');
      await userEvent.type(title, 'Call Müller?');
      expect(screen.getByText('↵ create · ⇧↵ text · Esc discard')).toBeInTheDocument();
      await userEvent.keyboard('{Enter}');
      await waitFor(() => expect(onDone).toHaveBeenCalledWith('n-new', false, []));
      expect(notesApi.remove).not.toHaveBeenCalled();
    });

    /**
     * The shell's side as plan R8 has it, with the real answer card: the answer is drawn as soon
     * as the question is heard, the capture stays until it ends, and the answer takes the focus
     * on mount only for a question asked with Enter, and only when the focus lies on the page.
     */
    function ShellStandIn({ onDone }: { onDone: () => void }) {
      const [asked, setAsked] = useState<{ question: string; takeFocus: boolean } | null>(null);
      const [capturing, setCapturing] = useState(true);
      const placement = { kind: 'free', x: 10, y: 20 } as const;
      return (
        <>
          {capturing && (
            <InlineCaptureCard
              boardId="b1"
              placement={placement}
              visibility="SHARED"
              layout="card"
              onDone={() => {
                setCapturing(false);
                onDone();
              }}
              onAsk={(question, { takeFocus }) => setAsked({ question, takeFocus })}
            />
          )}
          {asked !== null && (
            <AskCard
              session={{
                id: 1,
                placement,
                question: asked.question,
                phase: 'asking',
                answer: null,
                refusal: null,
                pinned: false,
                paused: false,
                takeFocus: asked.takeFocus,
              }}
              notes={[]}
              layout="card"
              onOpenNote={vi.fn()}
              onSetPinned={vi.fn()}
              onDismiss={vi.fn()}
              onPause={vi.fn()}
            />
          )}
          {/* Somewhere on the wall that takes no focus, as the empty canvas is. */}
          <div data-testid="wall">wall</div>
        </>
      );
    }

    it('lets go of the focus before handing the question over, so the answer can take it', async () => {
      // The draft note's create is still under way when Enter is pressed.
      let finishCreate: (note: NoteDto) => void = () => {};
      vi.mocked(notesApi.create).mockReturnValue(
        new Promise<NoteDto>((resolve) => {
          finishCreate = resolve;
        }),
      );
      const onDone = vi.fn();
      renderWithProviders(<ShellStandIn onDone={onDone} />);
      const title = screen.getByLabelText('Title of the new note');
      await userEvent.type(title, 'What is open today?{Enter}');

      // The answer is drawn while the capture still waits for the create, and has the focus.
      const answer = await screen.findByRole('group', { name: 'Answer from the wall' });
      expect(answer).toHaveFocus();
      expect(screen.getByRole('group', { name: 'Write a new note' })).toBeInTheDocument();
      expect(onDone).not.toHaveBeenCalled();

      // The create lands, the draft note goes, the capture ends; the answer keeps the focus.
      await act(async () => finishCreate(created({ title: 'What is open today?' })));
      await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('n-new', expect.anything()));
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole('group', { name: 'Write a new note' })).not.toBeInTheDocument();
      expect(answer).toHaveFocus();
    });

    it('a question asked by a click elsewhere leaves the focus where that click put it', async () => {
      vi.mocked(notesApi.create).mockResolvedValue(created({ title: 'What is late?' }));
      const onDone = vi.fn();
      renderWithProviders(<ShellStandIn onDone={onDone} />);
      await userEvent.type(screen.getByLabelText('Title of the new note'), 'What is late?');
      // A click on the wall moves the focus to the page; the capture settles by its blur.
      await userEvent.click(screen.getByTestId('wall'));
      const answer = await screen.findByRole('group', { name: 'Answer from the wall' });
      await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
      expect(answer).not.toHaveFocus();
      expect(document.activeElement).toBe(document.body);
    });

    it('a question asked from the text line lets go of the focus too', async () => {
      let focusedAtAsk: Element | null = null;
      const onAsk = vi.fn(() => {
        focusedAtAsk = document.activeElement;
      });
      const { title } = renderAsking(onAsk);
      await userEvent.type(title, 'Which are overdue?{Shift>}{Enter}{/Shift}');
      await userEvent.type(screen.getByLabelText('Text of the new note'), 'Only mine{Enter}');
      await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));
      expect(focusedAtAsk).toBe(document.body);
    });

    it('after a blur that put the focus elsewhere, the question leaves the focus there', async () => {
      let focusedAtAsk: Element | null = null;
      const onAsk = vi.fn(() => {
        focusedAtAsk = document.activeElement;
      });
      renderWithProviders(
        <>
          <InlineCaptureCard
            boardId="b1"
            placement={{ kind: 'free', x: 10, y: 20 }}
            visibility="SHARED"
            layout="card"
            onDone={vi.fn()}
            onAsk={onAsk}
          />
          <button type="button">elsewhere</button>
        </>,
      );
      await userEvent.type(screen.getByLabelText('Title of the new note'), 'What is late?');
      const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
      await userEvent.click(elsewhere);
      await waitFor(() =>
        expect(onAsk).toHaveBeenCalledWith('What is late?', { takeFocus: false }),
      );
      expect(focusedAtAsk).not.toBe(screen.getByLabelText('Title of the new note'));
      expect(elsewhere).toHaveFocus();
    });

    it('tells a screen reader that Enter asks, once the title ends in a question mark', async () => {
      const { title } = renderAsking();
      const live = document.querySelector('[data-testid="capture-ask-live"]')!;
      expect(live).toHaveAttribute('aria-live', 'polite');
      expect(live).toHaveClass('sr-only');
      await userEvent.type(title, 'What is open today');
      expect(live).toHaveTextContent('');
      await userEvent.type(title, '?');
      expect(live).toHaveTextContent('Enter asks the wall');
    });

    it('shows no chips and marks no words while the title is a question', async () => {
      const { title } = renderAsking();
      await userEvent.type(title, 'urgent work for Friday');
      expect(screen.getByRole('button', { name: 'High priority' })).toBeInTheDocument();
      expect(screen.getAllByTestId('capture-mark')).toHaveLength(2);
      await userEvent.type(title, ' now?');
      expect(screen.queryByRole('button', { name: 'High priority' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Due / })).not.toBeInTheDocument();
      expect(screen.queryAllByTestId('capture-mark')).toHaveLength(0);
    });

    it('keeps the title read-only and busy while the question settles', async () => {
      let finishCreate: (note: NoteDto) => void = () => {};
      vi.mocked(notesApi.create).mockReturnValue(
        new Promise<NoteDto>((resolve) => {
          finishCreate = resolve;
        }),
      );
      const { onAsk, onDone, title } = renderAsking();
      await userEvent.type(title, 'What is open today?{Enter}');
      await waitFor(() => expect(onAsk).toHaveBeenCalledTimes(1));
      expect(title).toHaveAttribute('readonly');
      expect(title).toHaveAttribute('aria-busy', 'true');
      await act(async () => finishCreate(created({ title: 'What is open today?' })));
      await waitFor(() => expect(onDone).toHaveBeenCalledWith(null, false, []));
    });

    it('caps the title at the note title length', () => {
      renderCard();
      expect(screen.getByLabelText('Title of the new note')).toHaveAttribute('maxlength', '200');
    });
  });
});
