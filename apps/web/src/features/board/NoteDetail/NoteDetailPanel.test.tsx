import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enumLabels } from '@/i18n/enumLabels';
import { i18n } from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeMember, makeNote, makeNoteDetail } from '@/test/fixtures';
import { Toaster } from '@/components/ui/toaster';
import { resetToasts } from '@/lib/toast';
import { NoteDetailPanel } from './NoteDetailPanel';

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
      canEdit
      axis="horizon"
      isBelowDesktop={false}
      onClose={onClose}
      onDuplicate={onDuplicate}
      currentUserId="user-1"
      {...overrides}
    />,
  );
  return { onClose, onDuplicate, ...utils };
}

describe('NoteDetailPanel', () => {
  /**
   * Completion used to be a filled, full-width button in the footer labelled "Erledigt".
   * That is the slot — and the word — every sheet uses for "dismiss", so people pressing it
   * to close the panel silently marked their to-do done instead. It is a checkbox now, which
   * is also how the list view has always completed a note.
   */
  describe('completing a note', () => {
    it('completes the note from a checkbox rather than a footer button', async () => {
      vi.mocked(notesApi.complete).mockResolvedValue(makeNoteDetail({ status: 'DONE' }));
      renderPanel();
      await screen.findByLabelText('Titel');

      const done = screen.getByRole('checkbox', { name: 'Erledigt' });
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
      await screen.findByLabelText('Titel');

      const done = screen.getByRole('checkbox', { name: 'Erledigt' });
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
      await screen.findByLabelText('Titel');

      // The only footer control is delete; closing is the header X (and Escape).
      expect(screen.queryByRole('button', { name: 'Erledigt' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Wieder offen' })).not.toBeInTheDocument();
    });

    it('does not offer the checkbox to a member who cannot edit', async () => {
      renderPanel({ canEdit: false });
      await screen.findByLabelText('Titel');

      expect(screen.getByRole('checkbox', { name: 'Erledigt' })).toBeDisabled();
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
      const field = await screen.findByLabelText('Titel');

      await user.clear(field);
      await user.type(field, 'Angebot prüfen');

      await waitFor(() =>
        expect(notesApi.update).toHaveBeenLastCalledWith(
          'note-1',
          { title: 'Angebot prüfen' },
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
      const field = await screen.findByLabelText('Titel');

      await user.clear(field);
      await user.type(field, 'Angebot prüfen{Enter}');

      expect(notesApi.update).toHaveBeenLastCalledWith(
        'note-1',
        { title: 'Angebot prüfen' },
        expect.objectContaining({
          operationId: expect.any(String),
          resource: expect.stringMatching(/^note:/),
          revision: expect.any(Number),
        }),
      );
      expect(field).toHaveValue('Angebot prüfen');
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
      const field = await screen.findByLabelText('Beschreibung');
      expect(field).toHaveAttribute('placeholder', 'Beschreibung hinzufügen…');

      await user.type(field, 'Erste Zeile{Enter}zweite');

      await waitFor(() =>
        expect(notesApi.update).toHaveBeenLastCalledWith(
          'note-1',
          {
            description: 'Erste Zeile\nzweite',
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
      vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ description: 'Alt' }));
      const user = userEvent.setup();
      renderPanel();
      const field = await screen.findByDisplayValue('Alt');

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
      const field = await screen.findByLabelText('Beschreibung');

      await user.type(field, 'Kurz');
      unmount();

      await waitFor(() =>
        expect(notesApi.update).toHaveBeenLastCalledWith(
          'note-1',
          { description: 'Kurz' },
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
      const field = await screen.findByLabelText('Beschreibung');
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
      await screen.findByLabelText('Titel');

      await user.click(screen.getByRole('button', { name: 'Duplizieren' }));

      expect(onDuplicate).toHaveBeenCalledWith('note-1');
    });

    it('is not offered to a member who cannot edit', async () => {
      renderPanel({ canEdit: false });
      await screen.findByLabelText('Titel');

      expect(screen.queryByRole('button', { name: 'Duplizieren' })).not.toBeInTheDocument();
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
      await screen.findByLabelText('Titel');
      await waitFor(() => expect(membersApi.list).toHaveBeenCalled());

      await user.click(screen.getByRole('combobox', { name: 'Zuständig' }));

      expect(await screen.findByRole('option', { name: /Nora Falk \(du\)/ })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: /Jonas Weber/ })).toBeInTheDocument();
    });

    it('still names an assignee who is no longer an active member', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(
        makeNoteDetail({
          assignee: { id: 'user-gone', email: 'ex@example.com', displayName: 'Ex Kollegin' },
        }),
      );
      renderPanel();
      await screen.findByLabelText('Titel');

      expect(screen.getByRole('combobox', { name: 'Zuständig' })).toHaveTextContent('Ex Kollegin');
    });
  });

  describe('closing the panel', () => {
    it('closes on Escape', async () => {
      const { onClose } = renderPanel();
      await screen.findByLabelText('Titel');

      await userEvent.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    // Escape has to reach the topmost layer first, or dismissing a dropdown would take the
    // whole panel with it.
    it('leaves Escape to an open dropdown', async () => {
      const user = userEvent.setup();
      const { onClose } = renderPanel();
      await screen.findByLabelText('Titel');
      await user.click(screen.getByRole('combobox', { name: 'Zuständig' }));
      await screen.findByRole('option', { name: 'Niemand' });

      await user.keyboard('{Escape}');

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  it('moves the note via the Priority control (POST /notes/:id/move, mode PRIORITY)', async () => {
    renderPanel();
    await screen.findByLabelText('Titel');

    // Priority is a single-select Radix ToggleGroup, exposed as a radiogroup/radio pair
    // (correct ARIA for a segmented single-choice control), not plain buttons.
    await userEvent.click(screen.getByRole('radio', { name: 'Hoch' }));

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

  it('moves the note via the zone control, labelled "Spalte" for the Horizon axis', async () => {
    renderPanel({ axis: 'horizon' });
    await screen.findByLabelText('Titel');

    expect(screen.getByText('Spalte')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Später' }));

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

  // In the Priority axis the zone is the priority, so a "Zeile" control would be a second
  // copy of the Priority row directly above it.
  it('shows no separate zone control for the Priority axis or in Frei mode', async () => {
    const { rerender } = renderPanel({ axis: 'priority' });
    await screen.findByLabelText('Titel');
    expect(screen.queryByText('Zeile')).not.toBeInTheDocument();
    expect(screen.getAllByRole('radio', { name: 'Hoch' })).toHaveLength(1);

    rerender(
      <NoteDetailPanel
        noteId="note-1"
        boardId="board-1"
        canEdit
        axis="free"
        isBelowDesktop={false}
        onClose={vi.fn()}
        onDuplicate={vi.fn()}
        currentUserId="user-1"
      />,
    );
    await waitFor(() => {
      expect(screen.queryByText('Spalte')).not.toBeInTheDocument();
      expect(screen.queryByText('Zeile')).not.toBeInTheDocument();
    });
  });

  it('offers exactly the 14 shared note-colour swatches, with no Apricot option', async () => {
    renderPanel();
    await screen.findByLabelText('Titel');

    for (const label of Object.values(enumLabels(i18n.t).colour)) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(Object.values(enumLabels(i18n.t).colour)).toHaveLength(14);
    expect(screen.queryByRole('button', { name: 'Apricot' })).not.toBeInTheDocument();
  });

  it('disables every field and hides the delete action for a VIEW-role member', async () => {
    renderPanel({ canEdit: false });
    await screen.findByLabelText('Titel');

    expect(screen.getByLabelText('Titel')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Hoch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: enumLabels(i18n.t).colour.WEISS })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  /**
   * No "are you sure?" dialog: the note leaves at once and a toast offers Undo. The DELETE
   * is only sent once that window closes, so Undo never has to recreate anything.
   */
  describe('deleting', () => {
    beforeEach(() => {
      resetToasts();
      vi.mocked(notesApi.list).mockResolvedValue([makeNote({ id: 'note-1', title: 'Angebot' })]);
    });

    async function deleteFromPanel() {
      const user = userEvent.setup();
      const onClose = vi.fn();
      renderWithProviders(
        <>
          <NoteDetailPanel
            noteId="note-1"
            boardId="board-1"
            canEdit
            axis="horizon"
            isBelowDesktop={false}
            onClose={onClose}
            onDuplicate={vi.fn()}
            currentUserId="user-1"
          />
          <Toaster />
        </>,
      );
      await screen.findByLabelText('Titel');
      await waitFor(() => expect(notesApi.list).toHaveBeenCalled());
      await user.click(screen.getByRole('button', { name: 'Löschen' }));
      expect(onClose).toHaveBeenCalled();
      return { user };
    }

    it('removes the note at once and offers Undo, without calling the API yet', async () => {
      const { user } = await deleteFromPanel();

      expect(await screen.findByText('„Angebot“ gelöscht')).toBeInTheDocument();
      expect(notesApi.remove).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Rückgängig' }));
      expect(screen.queryByText('„Angebot“ gelöscht')).not.toBeInTheDocument();
      expect(notesApi.remove).not.toHaveBeenCalled();
    });

    it('sends the DELETE once the undo window is closed', async () => {
      const { user } = await deleteFromPanel();
      const toastItem = (await screen.findByText('„Angebot“ gelöscht')).closest('li')!;

      await user.click(within(toastItem).getByRole('button', { name: 'Schließen' }));

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
});
