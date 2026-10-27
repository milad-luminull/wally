import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import type { SuggestionFields } from '@wally/shared';
import type { SuggestionMark } from '../Suggestions/useSuggestions';
import { NoteRow } from './NoteRow';
import { i18n } from '@/i18n';
import { dueInfo } from '../util/noteDerived';
/** A date as the card's own meta line words it (Tomorrow, Fri…), which the rows reuse. */
const dueWords = (iso: string) => dueInfo({ status: 'OPEN', dueDate: iso }, i18n.t).label;

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
    onSetTag: vi.fn(),
    onSetProperty: vi.fn(),
    onPause: vi.fn(),
  });
  const rowOf = () => screen.getByText('Approve the quote comparison').closest('[role="button"]')!;
  const renderRow = (p = pending(), onOpen = vi.fn()) => {
    render(
      <NoteRow
        note={makeNote({ dueDate: null, priority: 'MEDIUM', assignee: null })}
        currentUserId="user-1"
        onOpen={onOpen}
        onToggleDone={vi.fn()}
        canEdit
        pending={p}
      />,
    );
    return p;
  };

  it('wraps the row in the moving border, with the proposed fields as rows under the title', () => {
    const p = renderRow();
    const row = rowOf();
    expect(row).toHaveAttribute('data-note-id', 'note-1');
    expect(row.closest('[data-capture-card]')?.className).toContain('capture-glow');
    // The border marks the change: no dashed edge and no dot on the row.
    expect(row.className).not.toContain('[border-left-style:dashed]');
    expect(screen.queryByRole('img', { name: /Proposed changes/ })).toBeNull();
    const list = screen.getByRole('list', { name: 'Suggested fields' });
    expect(within(list).getByText(dueWords('2026-10-23'))).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: 'Leave out: Priority High' }),
    ).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Leave out: Person Anna' }));
    expect(p.onSetField).toHaveBeenCalledWith('assignee', false);
    // The footer keeps and undoes; the done checkbox waits until the change is decided.
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(p.onKeep).toHaveBeenCalledWith('click');
    // The done box leaves the row under review, so the title lines up with the rows below.
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('the list and footer sit beside the row, not inside its button role', () => {
    renderRow();
    expect(within(rowOf() as HTMLElement).queryByRole('list')).toBeNull();
    expect(screen.getByRole('list', { name: 'Suggested fields' })).toBeInTheDocument();
    expect(within(rowOf() as HTMLElement).queryByRole('button', { name: 'Keep' })).toBeNull();
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

  it('stays paused while focus moves from the row to a control in its card', () => {
    const p = renderRow();
    const row = rowOf();
    const control = screen.getByRole('button', { name: 'Leave out: Priority High' });
    fireEvent.focus(row);
    fireEvent.blur(row, { relatedTarget: control });
    fireEvent.focus(control);
    expect(p.onPause).toHaveBeenCalledTimes(1);
    fireEvent.blur(control);
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

  it('keeps the person’s title on the row and offers the new one in the Title row, its text in a Text row', () => {
    const description = { value: 'For the Müller quote.', reason: 'moved out' };
    const on = withProposals(['dueDate', 'title', 'description'], { title: TITLE, description });
    render(
      <NoteRow
        note={makeNote({ dueDate: null })}
        currentUserId="user-1"
        onOpen={vi.fn()}
        onToggleDone={vi.fn()}
        canEdit
        pending={on}
      />,
    );
    const list = screen.getByRole('list', { name: 'Suggested fields' });
    expect(screen.getByText('Approve the quote comparison')).toBeInTheDocument();
    expect(within(list).getByText('Quote for Müller')).toBeInTheDocument();
    expect(within(list).getByText('For the Müller quote.')).toBeInTheDocument();
    fireEvent.click(
      within(list).getByRole('button', { name: 'Leave out: Title Quote for Müller' }),
    );
    expect(on.onSetField).toHaveBeenCalledWith('title', false);
  });

  it('shows the reference and each step as rows with an × each', () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Leave out: Customer Müller GmbH' }));
    expect(p.onSetField).toHaveBeenCalledWith('reference', false);
    fireEvent.click(screen.getByRole('button', { name: 'Bring back: Step Compare' }));
    expect(p.onSetSubtask).toHaveBeenCalledWith(1, true);
  });

  it('looks like any other row once kept, with only the faint Undo left', () => {
    const onOpen = vi.fn();
    const p = renderRow(pending({ phase: 'kept', countdownEndsAt: null }), onOpen);
    expect(rowOf().className).not.toContain('[border-left-style:dashed]');
    expect(screen.queryByRole('img', { name: /Proposed changes/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove suggestion/ })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Suggested fields' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep' })).toBeNull();
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
      kept: {
        fields: ['dueDate' as const],
        subtasks: [],
        links: [],
        tags: [],
        properties: [],
        revision: 2,
      },
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
    onSetTag: vi.fn(),
    onSetProperty: vi.fn(),
    onPause: vi.fn(),
  };
  it('shows the kept date, without an ×, until the refetched note carries it', () => {
    const { rerender } = render(
      <NoteRow
        note={makeNote({ revision: 1, dueDate: null, priority: 'MEDIUM', assignee: null })}
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
        note={makeNote({ revision: 2, dueDate: '2026-10-23', priority: 'MEDIUM', assignee: null })}
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
  it('counts the related notes in its meta line, and says nothing without any', () => {
    const row = (links: string[], relatedCount?: number) => (
      <NoteRow
        note={makeNote({ links, assignee: null })}
        currentUserId="user-1"
        onOpen={vi.fn()}
        onToggleDone={vi.fn()}
        canEdit
        relatedCount={relatedCount}
      />
    );
    const { rerender } = render(row(['b', 'c'], 2));
    expect(screen.getByText(/2 related/)).toBeInTheDocument();
    rerender(row([]));
    expect(screen.queryByText(/related/)).toBeNull();
    // The board's count, not the raw id list: a dangling id is not counted (L7), a backlink is (L1).
    rerender(row(['b', 'gone'], 1));
    expect(screen.getByText(/1 related/)).toBeInTheDocument();
    rerender(row([], 1));
    expect(screen.getByText(/1 related/)).toBeInTheDocument();
    rerender(row(['gone'], 0));
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

it('identifies the list row whose detail panel is open', () => {
  const note = makeNote();
  const { rerender } = render(
    <NoteRow
      note={note}
      currentUserId="user-1"
      selected
      onOpen={vi.fn()}
      onToggleDone={vi.fn()}
      canEdit
    />,
  );
  const row = screen.getByText(note.title).closest('[role="button"]')!;
  expect(row).toHaveAttribute('aria-current', 'true');
  rerender(
    <NoteRow
      note={note}
      currentUserId="user-1"
      selected={false}
      onOpen={vi.fn()}
      onToggleDone={vi.fn()}
      canEdit
    />,
  );
  expect(row).not.toHaveAttribute('aria-current');
});
