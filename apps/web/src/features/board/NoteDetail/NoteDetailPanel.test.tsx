import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enumLabels } from '@/i18n/enumLabels';
import { i18n } from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeMember, makeNote, makeNoteDetail, makeSuggestionMark } from '@/test/fixtures';
import type { PendingProps } from '../Suggestions/pendingProps';
import { Toaster } from '@/components/ui/toaster';
import { resetToasts } from '@/lib/toast';
import { boardAccess } from '../util/permissions';
import { NoteDetailPanel } from './NoteDetailPanel';

// No LanguageProvider here (it would fetch /me); useLanguage answers what the provider would,
// the active i18n language, which the rows and property editor sort by.
vi.mock('@/i18n/LanguageProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/LanguageProvider')>();
  const { i18n } = await import('@/i18n');
  const { FALLBACK_LOCALE, normalizeLocale } = await import('@/i18n/locales');
  return {
    ...actual,
    useLanguage: () => ({
      language: normalizeLocale(i18n.language) ?? FALLBACK_LOCALE,
      setLanguage: () => {},
      isSaving: false,
      saveFailed: false,
    }),
  };
});

vi.mock('@/lib/resources', () => ({
  notesApi: {
    get: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    move: vi.fn(),
    assign: vi.fn(),
    complete: vi.fn(),
    reopen: vi.fn(),
    remove: vi.fn(),
  },
  subtasksApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  membersApi: { list: vi.fn() },
}));

import { membersApi, notesApi } from '@/lib/resources';

beforeEach(() => {
  vi.mocked(notesApi.get).mockResolvedValue(
    makeNoteDetail({ priority: 'MITTEL', horizon: 'HEUTE' }),
  );
  vi.mocked(notesApi.move).mockResolvedValue(
    makeNoteDetail({ priority: 'HOCH', horizon: 'SPAETER' }),
  );
  vi.mocked(notesApi.remove).mockResolvedValue(undefined);
  vi.mocked(notesApi.list).mockResolvedValue([]);
  vi.mocked(membersApi.list).mockResolvedValue([]);
});

function renderPanel(overrides: Partial<Parameters<typeof NoteDetailPanel>[0]> = {}) {
  const onClose = vi.fn();
  const onDuplicate = vi.fn();
  const utils = renderWithProviders(
    <NoteDetailPanel
      noteId="note-1"
      boardId="board-1"
      access={boardAccess('OWNER', 'user-1', 'all')}
      axis="horizon"
      isBelowDesktop={false}
      onClose={onClose}
      onOpenNote={vi.fn()}
      onDuplicate={onDuplicate}
      currentUserId="user-1"
      {...overrides}
    />,
  );
  return { onClose, onDuplicate, ...utils };
}

describe('NoteDetailPanel', () => {
  it('opens a related note from the panel and offers an unlinked note', async () => {
    const onOpenNote = vi.fn();
    vi.mocked(notesApi.list).mockResolvedValue([
      makeNoteDetail({ id: 'backlink', title: 'Incoming', links: ['note-1'] }),
      makeNoteDetail({ id: 'candidate', title: 'Candidate' }),
    ]);
    renderPanel({ onOpenNote });
    await userEvent.click(await screen.findByTitle('Linked from Incoming'));
    expect(onOpenNote).toHaveBeenCalledWith('backlink');
    await userEvent.click(screen.getByRole('button', { name: 'Link a note…' }));
    expect(screen.getByRole('option', { name: 'Candidate' })).toBeVisible();
  });
  /**
   * Completion used to be a filled, full-width button in the footer labelled "Done".
   * That is the slot — and the word — every sheet uses for "dismiss", so people pressing it
   * to close the panel silently marked their to-do done instead. It is a checkbox now, which
   * is also how the list view has always completed a note.
   */
  describe('completing a note', () => {
    it('completes the note from a checkbox rather than a footer button', async () => {
      vi.mocked(notesApi.complete).mockResolvedValue(makeNoteDetail({ status: 'DONE' }));
      renderPanel();
      await screen.findByLabelText('Title');

      const done = screen.getByRole('checkbox', { name: 'Done' });
      expect(done).not.toBeChecked();
      await userEvent.click(done);

      await waitFor(() =>
        expect(notesApi.complete).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({
            operationId: expect.any(String),
            resource: expect.stringMatching(/^note:/),
            revision: expect.any(Number),
          }),
        ),
      );
    });

    it('reopens a completed note from the same checkbox', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ status: 'DONE' }));
      vi.mocked(notesApi.reopen).mockResolvedValue(makeNoteDetail({ status: 'OPEN' }));
      renderPanel();
      await screen.findByLabelText('Title');

      const done = screen.getByRole('checkbox', { name: 'Done' });
      expect(done).toBeChecked();
      await userEvent.click(done);

      await waitFor(() =>
        expect(notesApi.reopen).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({
            operationId: expect.any(String),
            resource: expect.stringMatching(/^note:/),
            revision: expect.any(Number),
          }),
        ),
      );
    });

    it('leaves no button that could be mistaken for a way out of the panel', async () => {
      renderPanel();
      await screen.findByLabelText('Title');

      // The only footer control is delete; closing is the header X (and Escape).
      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reopen' })).not.toBeInTheDocument();
    });

    it('does not offer the checkbox to a member who cannot edit', async () => {
      renderPanel({ access: boardAccess('VIEW', 'user-1', 'all') });
      await screen.findByLabelText('Title');

      expect(screen.getByRole('checkbox', { name: 'Done' })).toBeDisabled();
    });
  });

  describe('editing the title', () => {
    // Stateful, like the API: once the title is saved, the refetch that follows returns it.
    beforeEach(() => {
      vi.mocked(notesApi.update).mockImplementation(async (_id, input) => {
        vi.mocked(notesApi.get).mockResolvedValue(
          makeNoteDetail({ priority: 'MITTEL', horizon: 'HEUTE', ...input }),
        );
        return makeNote({ ...input });
      });
    });

    it('saves while typing, without needing to leave the field', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await screen.findByLabelText('Title');

      await user.clear(field);
      await user.type(field, 'Check the quote');

      await waitFor(() =>
        expect(notesApi.update).toHaveBeenLastCalledWith(
          'note-1',
          { title: 'Check the quote' },
          expect.objectContaining({
            operationId: expect.any(String),
            resource: expect.stringMatching(/^note:/),
            revision: expect.any(Number),
          }),
        ),
      );
      expect(field).toHaveFocus();
    });

    it('finishes on Enter instead of adding a line break', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await screen.findByLabelText('Title');

      await user.clear(field);
      await user.type(field, 'Check the quote{Enter}');

      expect(notesApi.update).toHaveBeenLastCalledWith(
        'note-1',
        { title: 'Check the quote' },
        expect.objectContaining({
          operationId: expect.any(String),
          resource: expect.stringMatching(/^note:/),
          revision: expect.any(Number),
        }),
      );
      expect(field).toHaveValue('Check the quote');
      expect(field).not.toHaveFocus();
    });
  });

  describe('editing the description', () => {
    beforeEach(() => {
      vi.mocked(notesApi.update).mockImplementation(async (_id, input) => {
        vi.mocked(notesApi.get).mockResolvedValue(
          makeNoteDetail({ priority: 'MITTEL', horizon: 'HEUTE', ...input }),
        );
        return makeNote({ ...input });
      });
    });

    it('saves while typing, and Enter adds a line instead of leaving', async () => {
      const user = userEvent.setup();
      renderPanel();
      const field = await screen.findByLabelText('Description');
      expect(field).toHaveAttribute('placeholder', 'Add a description…');

      await user.type(field, 'First line{Enter}second');

      await waitFor(() =>
        expect(notesApi.update).toHaveBeenLastCalledWith(
          'note-1',
          {
            description: 'First line\nsecond',
          },
          expect.objectContaining({
            operationId: expect.any(String),
            resource: expect.stringMatching(/^note:/),
            revision: expect.any(Number),
          }),
        ),
      );
      expect(field).toHaveFocus();
    });

    it('can be cleared', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ description: 'Old' }));
      const user = userEvent.setup();
      renderPanel();
      const field = await screen.findByDisplayValue('Old');

      await user.clear(field);
      await user.tab();

      expect(notesApi.update).toHaveBeenLastCalledWith(
        'note-1',
        { description: '' },
        expect.objectContaining({
          operationId: expect.any(String),
          resource: expect.stringMatching(/^note:/),
          revision: expect.any(Number),
        }),
      );
    });

    it('sends what was typed when the panel closes before the save delay', async () => {
      const user = userEvent.setup();
      const { unmount } = renderPanel();
      const field = await screen.findByLabelText('Description');

      await user.type(field, 'Short');
      unmount();

      await waitFor(() =>
        expect(notesApi.update).toHaveBeenLastCalledWith(
          'note-1',
          { description: 'Short' },
          expect.objectContaining({
            operationId: expect.any(String),
            resource: expect.stringMatching(/^note:/),
            revision: expect.any(Number),
          }),
        ),
      );
    });

    it('leaves the field, not the panel, on the first Escape', async () => {
      const user = userEvent.setup();
      const { onClose } = renderPanel();
      const field = await screen.findByLabelText('Description');
      await user.click(field);

      await user.keyboard('{Escape}');

      expect(field).not.toHaveFocus();
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('duplicating', () => {
    it('duplicates from the footer button', async () => {
      const user = userEvent.setup();
      const { onDuplicate } = renderPanel();
      await screen.findByLabelText('Title');

      await user.click(screen.getByRole('button', { name: 'Duplicate' }));

      expect(onDuplicate).toHaveBeenCalledWith('note-1');
    });

    it('is not offered to a member who cannot edit', async () => {
      renderPanel({ access: boardAccess('VIEW', 'user-1', 'all') });
      await screen.findByLabelText('Title');

      expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    });
  });

  describe('choosing an assignee', () => {
    it('marks your own entry, so it cannot be mistaken for someone else', async () => {
      vi.mocked(membersApi.list).mockResolvedValue([
        makeMember({ id: 'member-1', userId: 'user-1', displayName: 'Nora Falk' }),
        makeMember({ id: 'member-2', userId: 'user-2', displayName: 'Jonas Weber' }),
      ]);
      const user = userEvent.setup();
      renderPanel({ currentUserId: 'user-1' });
      await screen.findByLabelText('Title');
      await waitFor(() => expect(membersApi.list).toHaveBeenCalled());

      await user.click(screen.getByRole('combobox', { name: 'Assignee' }));

      expect(await screen.findByRole('option', { name: /Nora Falk \(you\)/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Jonas Weber/ })).toBeInTheDocument();
    });

    it('still names an assignee who is no longer an active member', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({
          assignee: { id: 'user-gone', email: 'ex@example.com', displayName: 'Former colleague' },
        }),
      );
      renderPanel();
      await screen.findByLabelText('Title');

      expect(screen.getByRole('combobox', { name: 'Assignee' })).toHaveTextContent(
        'Former colleague',
      );
    });
  });

  describe('the Private switch', () => {
    const me = { id: 'user-1', email: 'nora.falk@example.com', displayName: 'Nora Falk' };
    const someoneElse = { id: 'user-2', email: 'jonas@example.com', displayName: 'Jonas Weber' };

    it('is offered, off and enabled, on your own shared note', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ id: 'note-1', createdBy: me, visibility: 'SHARED' }),
      );
      renderPanel();
      await screen.findByLabelText('Title');

      const toggle = screen.getByRole('switch', { name: 'Private' });
      expect(toggle).not.toBeChecked();
      expect(toggle).toBeEnabled();
      expect(toggle).toHaveAccessibleDescription('Only you can see a private note.');
    });

    it("is not offered on someone else's shared note", async () => {
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ id: 'note-1', createdBy: someoneElse, visibility: 'SHARED' }),
      );
      renderPanel();
      await screen.findByLabelText('Title');

      expect(screen.queryByRole('switch', { name: 'Private' })).not.toBeInTheDocument();
    });

    it("is on and locked for a viewer's own private note, which they can still edit", async () => {
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ id: 'note-1', createdBy: me, assignee: me, visibility: 'PRIVATE' }),
      );
      renderPanel({ access: boardAccess('VIEW', 'user-1', 'all') });
      const title = await screen.findByLabelText('Title');

      const toggle = screen.getByRole('switch', { name: 'Private' });
      expect(toggle).toBeChecked();
      expect(toggle).toBeDisabled();
      expect(toggle).toHaveAccessibleDescription('You need edit rights to share it.');
      expect(title).toBeEnabled();
      // The locked assignee row names the assignee in words, with the reason after it.
      const helper = screen.getByText('A private note is always yours.');
      expect(within(helper.parentElement!).getByText('You')).toBeVisible();
      expect(screen.queryByRole('combobox', { name: 'Assignee' })).not.toBeInTheDocument();
    });

    it('keeps the assignee picker for a shared note', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ id: 'note-1', createdBy: me, visibility: 'SHARED' }),
      );
      renderPanel();
      await screen.findByLabelText('Title');

      expect(screen.getByRole('combobox', { name: 'Assignee' })).toBeInTheDocument();
      expect(screen.queryByText('A private note is always yours.')).not.toBeInTheDocument();
    });

    it('makes the note private when clicked', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ id: 'n1', createdBy: me, visibility: 'SHARED' }),
      );
      vi.mocked(notesApi.update).mockResolvedValue(makeNote({ id: 'n1', visibility: 'PRIVATE' }));
      const user = userEvent.setup();
      renderPanel({ noteId: 'n1' });
      await screen.findByLabelText('Title');

      await user.click(screen.getByRole('switch', { name: 'Private' }));

      await waitFor(() =>
        expect(notesApi.update).toHaveBeenCalledWith(
          'n1',
          { visibility: 'PRIVATE' },
          expect.anything(),
        ),
      );
    });

    it('works from the keyboard', async () => {
      // Mocks are not reset between tests; count only this test's calls.
      vi.mocked(notesApi.update).mockClear();
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ id: 'n1', createdBy: me, visibility: 'SHARED' }),
      );
      vi.mocked(notesApi.update).mockResolvedValue(makeNote({ id: 'n1', visibility: 'PRIVATE' }));
      const user = userEvent.setup();
      renderPanel({ noteId: 'n1' });
      await screen.findByLabelText('Title');

      screen.getByRole('switch', { name: 'Private' }).focus();
      await user.keyboard(' ');

      await waitFor(() => expect(notesApi.update).toHaveBeenCalledTimes(1));
    });
  });

  describe('closing the panel', () => {
    it('closes on Escape', async () => {
      const { onClose } = renderPanel();
      await screen.findByLabelText('Title');

      await userEvent.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    // Escape has to reach the topmost layer first, or dismissing a dropdown would take the
    // whole panel with it.
    it('leaves Escape to an open dropdown', async () => {
      const user = userEvent.setup();
      const { onClose } = renderPanel();
      await screen.findByLabelText('Title');
      await user.click(screen.getByRole('combobox', { name: 'Assignee' }));
      await screen.findByRole('option', { name: 'Nobody' });

      await user.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('moves the note via the Priority control (POST /notes/:id/move, mode PRIORITY)', async () => {
    renderPanel();
    await screen.findByLabelText('Title');

    // Priority is a single-select Radix ToggleGroup, exposed as a radiogroup/radio pair
    // (correct ARIA for a segmented single-choice control), not plain buttons.
    await userEvent.click(screen.getByRole('radio', { name: 'High' }));

    await waitFor(() =>
      expect(notesApi.move).toHaveBeenCalledWith(
        'note-1',
        { mode: 'PRIORITY', priority: 'HOCH' },
        expect.objectContaining({
          operationId: expect.any(String),
          resource: expect.stringMatching(/^note:/),
          revision: expect.any(Number),
        }),
      ),
    );
  });

  it('moves the note via the zone control, labelled "Column" for the Horizon axis', async () => {
    renderPanel({ axis: 'horizon' });
    await screen.findByLabelText('Title');

    expect(screen.getByText('Column')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Later' }));

    await waitFor(() =>
      expect(notesApi.move).toHaveBeenCalledWith(
        'note-1',
        { mode: 'HORIZON', horizon: 'SPAETER' },
        expect.objectContaining({
          operationId: expect.any(String),
          resource: expect.stringMatching(/^note:/),
          revision: expect.any(Number),
        }),
      ),
    );
  });

  // In the Priority axis the zone is the priority, so a "Row" control would be a second
  // copy of the Priority row directly above it.
  it('shows no separate zone control for the Priority axis or in free mode', async () => {
    const { rerender } = renderPanel({ axis: 'priority' });
    await screen.findByLabelText('Title');
    expect(screen.queryByText('Row')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: 'High' })).toHaveLength(1);

    rerender(
      <NoteDetailPanel
        noteId="note-1"
        boardId="board-1"
        access={boardAccess('OWNER', 'user-1', 'all')}
        axis="free"
        isBelowDesktop={false}
        onClose={vi.fn()}
        onOpenNote={vi.fn()}
        onDuplicate={vi.fn()}
        currentUserId="user-1"
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText('Column')).not.toBeInTheDocument();
      expect(screen.queryByText('Row')).not.toBeInTheDocument();
    });
  });

  it('offers exactly the 14 shared note-colour swatches, with no Apricot option', async () => {
    renderPanel();
    await screen.findByLabelText('Title');

    for (const label of Object.values(enumLabels(i18n.t).colour)) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(Object.values(enumLabels(i18n.t).colour)).toHaveLength(14);
    expect(screen.queryByRole('button', { name: 'Apricot' })).not.toBeInTheDocument();
  });

  it('disables every field and hides the delete action for a VIEW-role member', async () => {
    renderPanel({ access: boardAccess('VIEW', 'user-1', 'all') });
    await screen.findByLabelText('Title');

    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'High' })).toBeDisabled();
    expect(screen.getByRole('button', { name: enumLabels(i18n.t).colour.WEISS })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  /**
   * No "are you sure?" dialog: the note leaves at once and a toast offers Undo. The DELETE
   * is only sent once that window closes, so Undo never has to recreate anything.
   */
  describe('deleting', () => {
    beforeEach(() => {
      resetToasts();
      vi.mocked(notesApi.list).mockResolvedValue([makeNote({ id: 'note-1', title: 'Quote' })]);
    });

    async function deleteFromPanel() {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderWithProviders(
        <>
          <NoteDetailPanel
            noteId="note-1"
            boardId="board-1"
            access={boardAccess('OWNER', 'user-1', 'all')}
            axis="horizon"
            isBelowDesktop={false}
            onClose={onClose}
            onOpenNote={vi.fn()}
            onDuplicate={vi.fn()}
            currentUserId="user-1"
          />
          <Toaster />
        </>,
      );
      await screen.findByLabelText('Title');
      await waitFor(() => expect(notesApi.list).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      expect(onClose).toHaveBeenCalled();
      return { user };
    }

    it('removes the note at once and offers Undo, without calling the API yet', async () => {
      const { user } = await deleteFromPanel();

      expect(await screen.findByText('“Quote” deleted')).toBeInTheDocument();
      expect(notesApi.remove).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.queryByText('“Quote” deleted')).not.toBeInTheDocument();
      expect(notesApi.remove).not.toHaveBeenCalled();
    });

    it('sends the DELETE once the undo window is closed', async () => {
      const { user } = await deleteFromPanel();
      const toastItem = (await screen.findByText('“Quote” deleted')).closest('li')!;

      await user.click(within(toastItem).getByRole('button', { name: 'Close' }));

      await waitFor(() =>
        expect(notesApi.remove).toHaveBeenCalledWith(
          'note-1',
          expect.objectContaining({
            operationId: expect.any(String),
            resource: expect.stringMatching(/^note:/),
            revision: expect.any(Number),
          }),
        ),
      );
    });
  });

  /** The smarter-capture spec, revision "editing the text asks again". */
  describe('an edit of the text', () => {
    it('reports one finished edit once focus leaves both text fields with the words changed', async () => {
      const user = userEvent.setup();
      vi.mocked(notesApi.update).mockResolvedValue(makeNote({ title: 'Quote for Anna' }));
      vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ title: 'Quote' }));
      const onTextEdited = vi.fn();
      renderPanel({ onTextEdited });
      const title = await screen.findByLabelText('Title');
      await user.click(title);
      await user.type(title, ' for Anna');
      // On into the description: still the same edit.
      await user.click(screen.getByLabelText('Description'));
      expect(onTextEdited).not.toHaveBeenCalled();
      await user.click(document.body);
      expect(onTextEdited).toHaveBeenCalledTimes(1);
      expect(onTextEdited).toHaveBeenCalledWith('note-1');
    });

    it('reports nothing when the words did not change', async () => {
      const user = userEvent.setup();
      vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ title: 'Quote' }));
      const onTextEdited = vi.fn();
      renderPanel({ onTextEdited });
      const title = await screen.findByLabelText('Title');
      await user.click(title);
      await user.type(title, 'x{Backspace}');
      await user.click(document.body);
      expect(onTextEdited).not.toHaveBeenCalled();
    });

    it('reports an edit the panel closed on', async () => {
      const user = userEvent.setup();
      vi.mocked(notesApi.update).mockResolvedValue(makeNote({ title: 'Quote 2' }));
      vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ title: 'Quote' }));
      const onTextEdited = vi.fn();
      const { unmount } = renderPanel({ onTextEdited });
      const title = await screen.findByLabelText('Title');
      await user.click(title);
      await user.type(title, ' 2');
      unmount();
      expect(onTextEdited).toHaveBeenCalledWith('note-1');
    });
  });

  /** The review of a pending change lives in the panel (plan R3), above everything else. */
  describe('reviewing a pending change', () => {
    function pendingFor(): PendingProps {
      const base = makeSuggestionMark();
      return {
        mark: makeSuggestionMark({
          // The date was typed: it is on the note, and the proposal holds none of its own.
          suggestion: {
            ...base.suggestion!,
            typed: ['dueDate'],
            fields: { ...base.suggestion!.fields, dueDate: null },
          },
          fields: ['priority', 'assignee'],
        }),
        onKeep: vi.fn(),
        onDiscard: vi.fn(),
        onUndo: vi.fn(),
        onRemove: vi.fn(),
        onSetField: vi.fn(),
        onSetSubtask: vi.fn(),
        onSetLink: vi.fn(),
        onSetTag: vi.fn(),
        onSetProperty: vi.fn(),
        onPause: vi.fn(),
      };
    }

    it('shows the review section only for a note with a pending change', async () => {
      const { unmount } = renderPanel();
      await screen.findByLabelText('Title');
      expect(document.querySelector('[data-pending-review]')).toBeNull();
      expect(screen.queryByRole('list', { name: 'Suggested fields' })).not.toBeInTheDocument();
      unmount();

      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ priority: 'MITTEL', dueDate: '2026-10-23' }),
      );
      renderPanel({ pending: pendingFor() });
      await screen.findByLabelText('Title');
      const review = document.querySelector('[data-pending-review]');
      expect(review).not.toBeNull();
      expect(
        within(review as HTMLElement).getByRole('list', { name: 'Suggested fields' }),
      ).toBeInTheDocument();
      // Above the subtasks: the first thing under the title and the description.
      const subtasks = screen.getByText('Subtasks');
      expect(review!.compareDocumentPosition(subtasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
    });

    it('shows "Filling in" in the review and shimmers the title while the change is asked for', async () => {
      renderPanel({
        pending: {
          ...pendingFor(),
          mark: makeSuggestionMark({ phase: 'asking', suggestion: null, fields: [] }),
        },
      });
      const title = await screen.findByLabelText('Title');
      const review = document.querySelector('[data-pending-review]') as HTMLElement;
      expect(within(review).getByRole('status')).toHaveTextContent('Filling in');
      expect(title).toHaveClass('capture-shimmer');
    });

    it('keeps the note’s own words in the fields and offers the new title in the review', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ title: 'call doc', description: '' }),
      );
      const base = makeSuggestionMark();
      renderPanel({
        pending: {
          ...pendingFor(),
          mark: makeSuggestionMark({
            suggestion: {
              ...base.suggestion!,
              fields: {
                ...base.suggestion!.fields,
                title: { value: 'Call the doctor', reason: 'clearer' },
                description: { value: 'About the check-up', reason: 'split' },
              },
            },
            fields: ['title', 'description', 'priority'],
          }),
        },
      });
      expect(await screen.findByLabelText('Title')).toHaveValue('call doc');
      expect(screen.getByLabelText('Description')).toHaveValue('');
      const review = document.querySelector('[data-pending-review]') as HTMLElement;
      expect(within(review).getByText('Call the doctor')).toBeInTheDocument();
      expect(within(review).getByText('About the check-up')).toBeInTheDocument();
    });

    /*
     * R4 as ruled: a typed row is read-only. The typed date changes in the panel's own date
     * field, which ends the pending change as any edit does (slice 2's stale-revision rule).
     */
    it('shows a typed row with no control, and a click on it sends nothing (R4)', async () => {
      const user = userEvent.setup();
      vi.mocked(notesApi.update).mockResolvedValue(makeNote({ dueDate: null }));
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ priority: 'MITTEL', dueDate: '2026-10-23' }),
      );
      const pending = pendingFor();
      renderPanel({ pending });
      await screen.findByLabelText('Title');

      const list = screen.getByRole('list', { name: 'Suggested fields' });
      const row = within(list).getByText('Due').closest('[role="listitem"]') as HTMLElement;
      expect(within(row).queryByRole('button')).toBeNull();
      // Calls from earlier cases stay on these mocks; only what the click sends counts here.
      vi.mocked(notesApi.update).mockClear();
      vi.mocked(notesApi.move).mockClear();
      vi.mocked(notesApi.assign).mockClear();
      await user.click(row);

      expect(notesApi.update).not.toHaveBeenCalled();
      expect(notesApi.move).not.toHaveBeenCalled();
      expect(notesApi.assign).not.toHaveBeenCalled();
      expect(pending.onSetField).not.toHaveBeenCalled();
    });

    /*
     * The ordinary update moves the note past the revision the change was proposed for, so the
     * shell's controller forgets the change (useSuggestions.syncNotes) and the review goes with
     * it; usePendingFor.test.tsx follows that through with the real controller. Here: the
     * keyboard is not dropped on the page when that happens.
     */
    it('keeps focus in the panel when the review goes from under it', async () => {
      const user = userEvent.setup();
      vi.mocked(notesApi.update).mockResolvedValue(makeNote({ dueDate: null }));
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ priority: 'MITTEL', dueDate: '2026-10-23' }),
      );
      const props = {
        noteId: 'note-1',
        boardId: 'board-1',
        access: boardAccess('OWNER', 'user-1', 'all'),
        axis: 'horizon' as const,
        isBelowDesktop: false,
        onClose: vi.fn(),
        onDuplicate: vi.fn(),
        onOpenNote: vi.fn(),
        currentUserId: 'user-1',
      };
      const { rerender } = renderWithProviders(
        <NoteDetailPanel {...props} pending={pendingFor()} />,
      );
      await screen.findByLabelText('Title');
      const list = screen.getByRole('list', { name: 'Suggested fields' });
      const row = within(list).getAllByRole('button')[0]!;
      await user.click(row);
      expect(row).toHaveFocus();

      rerender(<NoteDetailPanel {...props} />);
      expect(document.querySelector('[data-pending-review]')).toBeNull();
      const panel = screen.getByRole('complementary');
      expect(document.activeElement).not.toBe(document.body);
      expect(panel).toContainElement(document.activeElement as HTMLElement);
      // The panel's close button: from there Tab carries on through the panel.
      expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
      // The title, not the review, held focus otherwise: the panel leaves it alone then.
      screen.getByLabelText('Title').focus();
      rerender(<NoteDetailPanel {...props} pending={pendingFor()} />);
      rerender(<NoteDetailPanel {...props} />);
      expect(screen.getByLabelText('Title')).toHaveFocus();
    });

    it('leaves focus alone when the person clicked away from the review before it went', async () => {
      const user = userEvent.setup();
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({ priority: 'MITTEL', dueDate: '2026-10-23' }),
      );
      const props = {
        noteId: 'note-1',
        boardId: 'board-1',
        access: boardAccess('OWNER', 'user-1', 'all'),
        axis: 'horizon' as const,
        isBelowDesktop: false,
        onClose: vi.fn(),
        onDuplicate: vi.fn(),
        onOpenNote: vi.fn(),
        currentUserId: 'user-1',
      };
      const { rerender } = renderWithProviders(
        <NoteDetailPanel {...props} pending={pendingFor()} />,
      );
      await screen.findByLabelText('Title');
      const list = screen.getByRole('list', { name: 'Suggested fields' });
      await user.click(within(list).getAllByRole('button')[0]!);
      // A click on the page behind the panel: focus goes to the page.
      await user.click(document.body);
      expect(document.body).toHaveFocus();

      rerender(<NoteDetailPanel {...props} />);
      expect(document.querySelector('[data-pending-review]')).toBeNull();
      expect(document.body).toHaveFocus();
    });
  });
});
