import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionFields } from '@wally/shared';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import { NoteRow } from './NoteRow';

// The rows sort in the reader's language, which useLanguage supplies outside a provider here.
const reader = vi.hoisted(() => ({ language: 'en' as 'de' | 'en' }));
vi.mock('@/i18n/LanguageProvider', async () => {
  const actual =
    await vi.importActual<typeof import('@/i18n/LanguageProvider')>('@/i18n/LanguageProvider');
  return {
    ...actual,
    useLanguage: () => ({
      language: reader.language,
      setLanguage: () => {},
      isSaving: false,
      saveFailed: false,
    }),
  };
});

afterEach(() => {
  reader.language = 'en';
  vi.restoreAllMocks();
});

describe('NoteRow with a pending change', () => {
  const pending = (over: Partial<SuggestionMark> = {}) => ({
    mark: makeSuggestionMark(over),
    onKeep: vi.fn(),
    onDiscard: vi.fn(),
    onUndo: vi.fn(),
    onRemove: vi.fn(),
    onSetField: vi.fn(),
    onSetSubtask: vi.fn(),
    onSetLink: vi.fn(),
    onPause: vi.fn(),
  });
  const rowOf = () => screen.getByText('Approve the quote comparison').closest('[role="button"]')!;
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
    const dot = screen.getByRole('img', { name: /Proposed changes/ });
    // The dot is the last thing on the row.
    expect(dot.parentElement?.lastElementChild).toBe(dot);
    expect(row.lastElementChild?.contains(dot)).toBe(true);
    expect(screen.getByText(/Fri,? 10\/23/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove suggestion: High priority' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove suggestion: Assigned to Anna' }));
    expect(p.onRemove).toHaveBeenCalledWith('assignee');
  });

  it('keeps on Enter instead of opening, discards on Esc', () => {
    const onOpen = vi.fn();
    const p = renderRow(pending(), onOpen);
    fireEvent.keyDown(rowOf(), { key: 'Enter' });
    expect(p.onKeep).toHaveBeenCalledWith('enter');
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
  const TITLE = { value: 'Quote for Müller', reason: 'shorter' };

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
    expect(screen.getByText('Approve the quote comparison')).toBeInTheDocument();
    const line = screen.getByRole('button', { name: 'Suggested: Quote for Müller' });
    expect(line).toHaveAttribute('aria-pressed', 'false');
    // What a press does, said only while the press would take the title.
    expect(line).toHaveAttribute('aria-description', 'Take the suggested title');
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
    const takenLine = screen.getByRole('button', { name: 'Suggested: Quote for Müller' });
    expect(takenLine).toHaveAttribute('aria-pressed', 'true');
    expect(takenLine).not.toHaveAttribute('aria-description');
    fireEvent.click(screen.getByRole('button', { name: 'Keep my title' }));
    expect(taken.onRemove).toHaveBeenCalledWith('title');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('shows the reference and the step count with an × each', () => {
    const p = renderRow(
      withProposals(
        ['dueDate', 'reference', 'subtasks'],
        {
          reference: { key: 'Customer', value: 'Müller GmbH', reason: 'Müller' },
          subtasks: { items: ['Get prices', 'Compare', 'Approve'], reason: 'process' },
        },
        { subtasks: [0, 2] },
      ),
    );
    expect(screen.getByText('Customer: Müller GmbH')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'Remove suggestion: Customer: Müller GmbH' }),
    );
    expect(p.onRemove).toHaveBeenCalledWith('reference');
    expect(screen.getByText('2 steps')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove suggestion: 2 steps' }));
    expect(p.onRemove).toHaveBeenCalledWith('subtasks');
  });

  it('looks like any other row once kept, with only the faint Undo left', () => {
    const onOpen = vi.fn();
    const p = renderRow(pending({ phase: 'kept', countdownEndsAt: null }), onOpen);
    expect(rowOf().className).not.toContain('[border-left-style:dashed]');
    expect(screen.queryByRole('img', { name: /Proposed changes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove suggestion/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo the kept changes' }));
    expect(p.onUndo).toHaveBeenCalledWith('click');
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
      kept: { fields: ['dueDate' as const], subtasks: [], links: [], revision: 2 },
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
    onSetLink: vi.fn(),
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
    expect(screen.getByText(/Fri,? 10\/23/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove suggestion/ })).toBeNull();
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
    expect(screen.queryByText(/Fri,? 10\/23/)).toBeNull();
  });
});

describe('NoteRow without a pending change', () => {
  it('counts the related notes in its meta line, and says nothing without links', () => {
    const row = (links: string[]) => (
      <NoteRow
        note={makeNote({ links, assignee: null })}
        currentUserId="user-1"
        onOpen={vi.fn()}
        onToggleDone={vi.fn()}
        canEdit
      />
    );
    const { rerender } = render(row(['b', 'c']));
    expect(screen.getByText(/2 related/)).toBeInTheDocument();
    rerender(row([]));
    expect(screen.queryByText(/related/)).toBeNull();
  });

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
    fireEvent.keyDown(
      screen.getByText('Approve the quote comparison').closest('[role="button"]')!,
      {
        key: 'Enter',
      },
    );
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it.each(['de', 'en'] as const)(
    'shows the first property in the order of a reader of %s',
    (language) => {
      reader.language = language;
      const compare = vi.spyOn(String.prototype, 'localeCompare');
      render(
        <NoteRow
          note={makeNote({ customFields: { Zebra: 'stripes', Ärger: 'trouble' } })}
          currentUserId="user-1"
          onOpen={vi.fn()}
          onToggleDone={vi.fn()}
          canEdit
        />,
      );
      // A code-point sort would pick Zebra (Z is U+005A, Ä is U+00C4).
      expect(screen.getByText(/Ärger: trouble/)).toBeInTheDocument();
      expect(screen.queryByText(/Zebra: stripes/)).toBeNull();
      expect(compare.mock.calls.map(([, locale]) => locale)).toContain(language);
    },
  );
});
