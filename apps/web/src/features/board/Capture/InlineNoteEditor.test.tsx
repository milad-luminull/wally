import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NoteDto } from '@wally/shared';

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

import { membersApi, notesApi } from '@/lib/resources';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { InlineNoteEditor, type EditResult } from './InlineNoteEditor';

const note = (overrides: Partial<NoteDto> = {}) =>
  makeNote({ id: 'n1', revision: 4, title: 'Call Müller', description: '', ...overrides });

function renderEditor(target: NoteDto = note()) {
  const onDone = vi.fn<(result: EditResult | null) => void>();
  const view = renderWithProviders(
    <>
      <InlineNoteEditor boardId="b1" note={target} layout="card" onDone={onDone} />
      <button type="button">Elsewhere</button>
    </>,
  );
  return { onDone, ...view };
}

const title = () => screen.getByRole('textbox', { name: 'Title of the note' });

describe('InlineNoteEditor', () => {
  beforeEach(() => {
    vi.mocked(notesApi.update)
      .mockReset()
      .mockImplementation(async (_id, input) => note({ ...(input as object) } as Partial<NoteDto>));
    vi.mocked(notesApi.move)
      .mockReset()
      .mockResolvedValue(note({ priority: 'HOCH' }));
    vi.mocked(notesApi.assign).mockReset().mockResolvedValue(note());
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
      ] as never);
  });

  it('opens on the note’s words with the caret at their end, and says how to finish', () => {
    renderEditor(note({ description: 'For the quote' }));
    expect(title()).toHaveValue('Call Müller');
    expect(title()).toHaveFocus();
    expect((title() as HTMLTextAreaElement).selectionStart).toBe('Call Müller'.length);
    expect(screen.getByRole('textbox', { name: 'Text of the note' })).toHaveValue('For the quote');
    expect(title()).toHaveAccessibleDescription('↵ save · ⇧↵ text · Esc keep as it was');
  });

  it('Esc puts the words back and writes nothing', async () => {
    const user = userEvent.setup();
    const { onDone } = renderEditor();
    await user.type(title(), ' today');
    await user.keyboard('{Escape}');
    expect(onDone).toHaveBeenCalledWith(null);
    expect(notesApi.update).not.toHaveBeenCalled();
  });

  it('Enter on unchanged words writes nothing and reports no change', async () => {
    const user = userEvent.setup();
    const { onDone } = renderEditor();
    await user.type(title(), 'x{Backspace}{Enter}');
    expect(onDone).toHaveBeenCalledWith({ changed: false, open: false, locked: [] });
    expect(notesApi.update).not.toHaveBeenCalled();
  });

  it('saves changed words with Enter, then reports the change', async () => {
    const user = userEvent.setup();
    const { onDone } = renderEditor();
    await user.type(title(), ' back{Enter}');
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ changed: true, open: false, locked: [] }),
    );
    expect(notesApi.update).toHaveBeenCalledWith(
      'n1',
      { title: 'Call Müller back', description: '' },
      expect.anything(),
    );
  });

  it('turns new words into chips as capture does, and locks what they set', async () => {
    const user = userEvent.setup();
    const { onDone } = renderEditor();
    await user.type(title(), ' Friday urgent');
    expect(screen.getAllByTestId('capture-mark').map((m) => m.textContent)).toEqual([
      'Friday',
      'urgent',
    ]);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({
        changed: true,
        open: false,
        locked: ['dueDate', 'priority'],
      }),
    );
    expect(notesApi.update).toHaveBeenCalledWith(
      'n1',
      expect.objectContaining({ dueDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      expect.anything(),
    );
    expect(notesApi.move).toHaveBeenCalledWith(
      'n1',
      { mode: 'PRIORITY', priority: 'HOCH' },
      expect.anything(),
    );
  });

  it('reads no chip from words the note already had', async () => {
    const user = userEvent.setup();
    const { onDone } = renderEditor(note({ title: 'Call Müller Friday' }));
    expect(screen.queryAllByTestId('capture-mark')).toHaveLength(0);
    await user.type(title(), ' about the quote{Enter}');
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(notesApi.update).toHaveBeenCalledWith(
      'n1',
      { title: 'Call Müller Friday about the quote', description: '' },
      expect.anything(),
    );
  });

  it('saves when focus leaves the editor', async () => {
    const user = userEvent.setup();
    const { onDone } = renderEditor();
    await user.type(title(), ' back');
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ changed: true, open: false, locked: [] }),
    );
  });

  it('⌘Enter saves and asks for the sidebar', async () => {
    const user = userEvent.setup();
    const { onDone } = renderEditor();
    await user.type(title(), ' back');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await waitFor(() =>
      expect(onDone).toHaveBeenCalledWith({ changed: true, open: true, locked: [] }),
    );
  });

  it('both fields erased count as Esc', async () => {
    const user = userEvent.setup();
    const { onDone } = renderEditor();
    await user.clear(title());
    await user.keyboard('{Enter}');
    expect(onDone).toHaveBeenCalledWith(null);
    expect(notesApi.update).not.toHaveBeenCalled();
  });
});
