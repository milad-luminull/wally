import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionFields } from '@wally/shared';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import { NoteRow } from './NoteRow';

describe('NoteRow with a pending change', () => {
  const pending = (over: Partial<SuggestionMark> = {}) => ({
    mark: makeSuggestionMark(over),
    onKeep: vi.fn(),
    onDiscard: vi.fn(),
    onUndo: vi.fn(),
    onRemove: vi.fn(),
    onSetField: vi.fn(),
    onSetSubtask: vi.fn(),
    onPause: vi.fn(),
  });
  const rowOf = () => screen.getByText('Angebotsvergleich freigeben').closest('[role="button"]')!;
  const renderRow = (p = pending(), onOpen = vi.fn()) => {
    render(
      <NoteRow
        note={makeNote({ dueDate: null, priority: 'MITTEL', assignee: null })}
        currentUserId="user-1"
        onOpen={onOpen}
        onToggleDone={vi.fn()}
        canEdit
        pending={p}
      />,
    );
    return p;
  };

  it('draws a dashed left edge, the dot at the end, and each proposed field with an ×', () => {
    const p = renderRow();
    const row = rowOf();
    // The left edge alone: `border-dashed` would dash the row's bottom divider too.
    expect(row.className).toContain('[border-left-style:dashed]');
    expect(row.className).not.toContain('border-dashed');
    expect(row).toHaveAttribute('data-note-id', 'note-1');
    const dot = screen.getByRole('img', { name: /Vorgeschlagene/ });
    // The dot is the last thing on the row.
    expect(dot.parentElement?.lastElementChild).toBe(dot);
    expect(row.lastElementChild?.contains(dot)).toBe(true);
    expect(screen.getByText(/Fr\.?,? 23\.10\./)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Vorschlag entfernen: Priorität hoch' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vorschlag entfernen: Zuständig: Anna' }));
    expect(p.onRemove).toHaveBeenCalledWith('assignee');
  });

  it('keeps on Enter instead of opening, discards on Esc', () => {
    const onOpen = vi.fn();
    const p = renderRow(pending(), onOpen);
    fireEvent.keyDown(rowOf(), { key: 'Enter' });
    expect(p.onKeep).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(rowOf(), { key: 'Escape' });
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('pauses the countdown on hover and focus, and resumes on leave and blur', () => {
    const p = renderRow();
    const row = rowOf();
    fireEvent.mouseEnter(row);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(row);
    expect(p.onPause).toHaveBeenLastCalledWith(false);
    fireEvent.focus(row);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
    fireEvent.blur(row);
    expect(p.onPause).toHaveBeenLastCalledWith(false);
  });

  it('stays paused while either hover or focus still holds', () => {
    const p = renderRow();
    const row = rowOf();
    fireEvent.focus(row);
    fireEvent.mouseEnter(row);
    fireEvent.mouseLeave(row);
    expect(p.onPause).toHaveBeenCalledTimes(1);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
    fireEvent.mouseEnter(row);
    fireEvent.blur(row);
    expect(p.onPause).toHaveBeenLastCalledWith(true);
    fireEvent.mouseLeave(row);
    expect(p.onPause).toHaveBeenLastCalledWith(false);
    expect(p.onPause).toHaveBeenCalledTimes(2);
  });

  it('stays paused while focus moves from the row to a control inside it', () => {
    const p = renderRow();
    const row = rowOf();
    const checkbox = screen.getByRole('checkbox');
    fireEvent.focus(row);
    fireEvent.blur(row, { relatedTarget: checkbox });
    fireEvent.focus(checkbox);
    expect(p.onPause).toHaveBeenCalledTimes(1);
    fireEvent.blur(checkbox);
    expect(p.onPause).toHaveBeenLastCalledWith(false);
  });

  /** A pending mark whose suggestion also proposes a title, a reference or steps. */
  const withProposals = (
    fields: SuggestionMark['fields'],
    extra: Partial<SuggestionFields>,
    over: Partial<SuggestionMark> = {},
  ) => {
    const base = makeSuggestionMark();
    return pending({
      fields,
      suggestion: { ...base.suggestion!, fields: { ...base.suggestion!.fields, ...extra } },
      ...over,
    });
  };
  const TITLE = { value: 'Angebot an Müller', reason: 'kürzer' };

  it('offers a cleaner title as a second line, taken by a tap and dropped by its ×', () => {
    const onOpen = vi.fn();
    const p = withProposals(['dueDate'], { title: TITLE });
    const row = (q: typeof p) => (
      <NoteRow
        note={makeNote({ dueDate: null })}
        currentUserId="user-1"
        onOpen={onOpen}
        onToggleDone={vi.fn()}
        canEdit
        pending={q}
      />
    );
    const { rerender } = render(row(p));
    expect(screen.getByText('Angebotsvergleich freigeben')).toBeInTheDocument();
    const line = screen.getByRole('button', { name: 'Vorschlag: Angebot an Müller' });
    expect(line).toHaveAttribute('aria-pressed', 'false');
    // A full-width line of its own, under the title.
    expect(line.closest('[data-proposed]')?.className).toContain('basis-full');
    fireEvent.click(line);
    expect(p.onSetField).toHaveBeenCalledWith('title', true);
    fireEvent.keyDown(line, { key: 'Enter' });
    expect(p.onSetField).toHaveBeenCalledTimes(2);
    expect(p.onKeep).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();

    const taken = withProposals(['dueDate', 'title'], { title: TITLE });
    rerender(row(taken));
    const takenLine = screen.getByRole('button', { name: 'Vorschlag: Angebot an Müller' });
    expect(takenLine).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Meinen Titel behalten' }));
    expect(taken.onRemove).toHaveBeenCalledWith('title');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows the reference and the step count with an × each', () => {
    const p = renderRow(
      withProposals(
        ['dueDate', 'reference', 'subtasks'],
        {
          reference: { key: 'Kunde', value: 'Müller GmbH', reason: 'Müller' },
          subtasks: { items: ['Preise holen', 'Vergleichen', 'Freigeben'], reason: 'Ablauf' },
        },
        { subtasks: [0, 2] },
      ),
    );
    expect(screen.getByText('Kunde: Müller GmbH')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Vorschlag entfernen: Kunde: Müller GmbH' }),
    );
    expect(p.onRemove).toHaveBeenCalledWith('reference');
    expect(screen.getByText('2 Schritte')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vorschlag entfernen: 2 Schritte' }));
    expect(p.onRemove).toHaveBeenCalledWith('subtasks');
  });

  it('looks like any other row once kept, with only the faint Undo left', () => {
    const onOpen = vi.fn();
    const p = renderRow(pending({ phase: 'kept', countdownEndsAt: null }), onOpen);
    expect(rowOf().className).not.toContain('[border-left-style:dashed]');
    expect(screen.queryByRole('img', { name: /Vorgeschlagene/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Vorschlag entfernen/ })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Übernommene Änderungen rückgängig machen' }),
    );
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('NoteRow just after a keep', () => {
  const kept = makeSuggestionMark({ phase: 'kept', countdownEndsAt: null });
  const keptMark = {
    ...kept,
    fields: ['dueDate' as const],
    suggestion: {
      ...kept.suggestion!,
      status: 'KEPT' as const,
      kept: { fields: ['dueDate' as const], subtasks: [], revision: 2 },
    },
  };
  const props = {
    mark: keptMark,
    onKeep: vi.fn(),
    onDiscard: vi.fn(),
    onUndo: vi.fn(),
    onRemove: vi.fn(),
    onSetField: vi.fn(),
    onSetSubtask: vi.fn(),
    onPause: vi.fn(),
  };
  it('shows the kept date, without an ×, until the refetched note carries it', () => {
    const { rerender } = render(
      <NoteRow
        note={makeNote({ revision: 1, dueDate: null, priority: 'MITTEL', assignee: null })}
        currentUserId="user-1"
        onOpen={vi.fn()}
        onToggleDone={vi.fn()}
        canEdit
        pending={props}
      />,
    );
    expect(screen.getByText(/Fr\.?,? 23\.10\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Vorschlag entfernen/ })).toBeNull();
    // The refetch lands: the note's own date takes the place, in its own label.
    rerender(
      <NoteRow
        note={makeNote({ revision: 2, dueDate: '2026-10-23', priority: 'MITTEL', assignee: null })}
        currentUserId="user-1"
        onOpen={vi.fn()}
        onToggleDone={vi.fn()}
        canEdit
        pending={props}
      />,
    );
    expect(screen.queryByText(/Fr\.?,? 23\.10\./)).toBeNull();
  });
});

describe('NoteRow without a pending change', () => {
  it('still opens the note on Enter', () => {
    const onOpen = vi.fn();
    render(
      <NoteRow
        note={makeNote()}
        currentUserId="user-1"
        onOpen={onOpen}
        onToggleDone={vi.fn()}
        canEdit
      />,
    );
    fireEvent.keyDown(screen.getByText('Angebotsvergleich freigeben').closest('[role="button"]')!, {
      key: 'Enter',
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
