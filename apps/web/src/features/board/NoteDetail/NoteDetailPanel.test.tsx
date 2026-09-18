import { describe, expect, it, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { COLOUR_LABELS } from '@wally/shared';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNoteDetail } from '@/test/fixtures';
import { NoteDetailPanel } from './NoteDetailPanel';

vi.mock('@/lib/resources', () => ({
  notesApi: { get: vi.fn(), update: vi.fn(), move: vi.fn(), assign: vi.fn(), complete: vi.fn(), reopen: vi.fn(), remove: vi.fn() },
  subtasksApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  membersApi: { list: vi.fn() },
  referenceOptionsApi: { list: vi.fn() },
}));

import { membersApi, notesApi } from '@/lib/resources';

beforeEach(() => {
  vi.mocked(notesApi.get).mockResolvedValue(makeNoteDetail({ priority: 'MITTEL', horizon: 'HEUTE' }));
  vi.mocked(notesApi.move).mockResolvedValue(makeNoteDetail({ priority: 'HOCH', horizon: 'SPAETER' }));
  vi.mocked(notesApi.remove).mockResolvedValue(undefined);
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

  it('offers exactly the 5 shared note-colour swatches, with no Apricot option', async () => {
    renderPanel();
    await screen.findByLabelText('Titel');

    for (const label of Object.values(COLOUR_LABELS)) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(Object.values(COLOUR_LABELS)).toHaveLength(5);
    expect(screen.queryByRole('button', { name: 'Apricot' })).not.toBeInTheDocument();
  });

  it('disables every field and hides the delete action for a VIEW-role member', async () => {
    renderPanel({ canEdit: false });
    await screen.findByLabelText('Titel');

    expect(screen.getByLabelText('Titel')).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Hoch' })).toBeDisabled();
    expect(screen.getByRole('button', { name: COLOUR_LABELS.WEISS })).toBeDisabled();
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
