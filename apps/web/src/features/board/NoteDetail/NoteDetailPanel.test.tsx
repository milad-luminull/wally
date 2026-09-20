import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { enumLabels } from '@/i18n/enumLabels';
import { i18n } from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNoteDetail } from '@/test/fixtures';
import { NoteDetailPanel } from './NoteDetailPanel';

vi.mock('@/lib/resources', () => ({
  notesApi: { get: vi.fn(), list: vi.fn(), update: vi.fn(), move: vi.fn(), assign: vi.fn(), complete: vi.fn(), reopen: vi.fn(), remove: vi.fn() },
  subtasksApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  membersApi: { list: vi.fn() },
}));

import { membersApi, notesApi } from '@/lib/resources';

beforeEach(() => {
  vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ priority: 'MITTEL', horizon: 'HEUTE' }));
  vi.mocked(notesApi.move).mockResolvedValue(makeNoteDetail({ priority: 'HOCH', horizon: 'SPAETER' }));
  vi.mocked(notesApi.remove).mockResolvedValue(undefined);
  vi.mocked(notesApi.list).mockResolvedValue([]);
  vi.mocked(membersApi.list).mockResolvedValue([]);
});

function renderPanel(overrides: Partial<Parameters<typeof NoteDetailPanel>[0]> = {}) {
  const onClose = vi.fn();
  const utils = renderWithProviders(
    <NoteDetailPanel
      noteId="note-1"
      boardId="board-1"
      canEdit
      axis="horizon"
      isBelowDesktop={false}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onClose, ...utils };
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

      await waitFor(() => expect(notesApi.complete).toHaveBeenCalledWith('note-1'));
    });

    it('reopens a completed note from the same checkbox', async () => {
      vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ status: 'DONE' }));
      vi.mocked(notesApi.reopen).mockResolvedValue(makeNoteDetail({ status: 'OPEN' }));
      renderPanel();
      await screen.findByLabelText('Titel');

      const done = screen.getByRole('checkbox', { name: 'Erledigt' });
      expect(done).toBeChecked();
      await userEvent.click(done);

      await waitFor(() => expect(notesApi.reopen).toHaveBeenCalledWith('note-1'));
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

  describe('closing the panel', () => {
    it('closes on Escape', async () => {
      const { onClose } = renderPanel();
      await screen.findByLabelText('Titel');

      await userEvent.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    // Escape has to reach the topmost layer first, or confirming a delete becomes impossible
    // to back out of without also losing the panel.
    it('leaves Escape to the delete dialog while it is open', async () => {
      const { onClose } = renderPanel();
      await screen.findByLabelText('Titel');
      await userEvent.click(screen.getByRole('button', { name: 'Löschen' }));
      await screen.findByRole('alertdialog');

      await userEvent.keyboard('{Escape}');

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
      expect(notesApi.move).toHaveBeenCalledWith('note-1', { mode: 'PRIORITY', priority: 'HOCH' }),
    );
  });

  it('moves the note via the zone control, labelled "Spalte" for the Horizon axis', async () => {
    renderPanel({ axis: 'horizon' });
    await screen.findByLabelText('Titel');

    expect(screen.getByText('Spalte')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('radio', { name: 'Später' }));

    await waitFor(() =>
      expect(notesApi.move).toHaveBeenCalledWith('note-1', { mode: 'HORIZON', horizon: 'SPAETER' }),
    );
  });

  it('labels the zone control "Zeile" for the Priority axis and hides it entirely in Frei mode', async () => {
    const { rerender } = renderPanel({ axis: 'priority' });
    await screen.findByLabelText('Titel');
    expect(screen.getByText('Zeile')).toBeInTheDocument();

    rerender(
      <NoteDetailPanel
        noteId="note-1"
        boardId="board-1"
        canEdit
        axis="free"
        isBelowDesktop={false}
        onClose={vi.fn()}
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

  it('asks for confirmation before deleting, and only deletes on confirm', async () => {
    const { onClose } = renderPanel();
    await screen.findByLabelText('Titel');

    await userEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Notiz löschen?')).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(notesApi.remove).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    const dialog2 = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog2).getByRole('button', { name: 'Löschen' }));

    await waitFor(() => expect(notesApi.remove).toHaveBeenCalledWith('note-1'));
    expect(onClose).toHaveBeenCalled();
  });
});
