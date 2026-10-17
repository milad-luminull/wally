import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import { NoteRow } from './NoteRow';

describe('NoteRow with a pending change', () => {
  const pending = (over: Partial<SuggestionMark> = {}) => ({
    mark: makeSuggestionMark(over),
    onKeep: vi.fn(),
    onDiscard: vi.fn(),
    onUndo: vi.fn(),
    onRemove: vi.fn(),
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
    expect(row.className).toContain('border-dashed');
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

  it('looks like any other row once kept, with only the faint Undo left', () => {
    const onOpen = vi.fn();
    const p = renderRow(pending({ phase: 'kept', countdownEndsAt: null }), onOpen);
    expect(rowOf().className).not.toContain('border-dashed');
    expect(screen.queryByRole('img', { name: /Vorgeschlagene/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Vorschlag entfernen/ })).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Übernommene Änderungen rückgängig machen' }),
    );
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
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
