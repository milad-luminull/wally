import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  membersApi: { list: vi.fn().mockResolvedValue([]) },
}));
// No LanguageProvider here (it would fetch /me): the cards and the editor read English.
vi.mock('@/i18n/LanguageProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/i18n/LanguageProvider')>()),
  useLanguage: () => ({ language: 'en', setLanguage: vi.fn(), isSaving: false, saveFailed: false }),
}));

import { makeNote, makeSuggestionMark } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import type { PendingProps } from '../Suggestions/pendingProps';
import { NoteCard } from '../WallView/NoteCard';
import { NoteRow } from '../ListView/NoteRow';
import type { InlineEditProps } from './inlineEdit';

/**
 * Where an edit in place starts and what it draws (the smarter-capture spec, revision "editing
 * the text asks again"): a double-click or F2 on a card or row, or a click on the title of one
 * under review; while editing, the editor stands where the card or row was.
 */
const edit = (over: Partial<InlineEditProps> = {}): InlineEditProps => ({
  boardId: 'b1',
  editing: false,
  start: vi.fn(),
  done: vi.fn(),
  ...over,
});

function pending(): PendingProps {
  return {
    mark: makeSuggestionMark(),
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

function renderCard(props: { edit: InlineEditProps; pending?: PendingProps; onOpen?: () => void }) {
  return renderWithProviders(
    <DndContext>
      <NoteCard
        note={makeNote({ id: 'n1', title: 'Call Müller' })}
        currentUserId="user-1"
        selected={false}
        onOpen={props.onOpen ?? vi.fn()}
        pending={props.pending}
        edit={props.edit}
      />
    </DndContext>,
  );
}

function renderRow(props: { edit: InlineEditProps; pending?: PendingProps; onOpen?: () => void }) {
  return renderWithProviders(
    <NoteRow
      note={makeNote({ id: 'n1', title: 'Call Müller' })}
      currentUserId="user-1"
      onOpen={props.onOpen ?? vi.fn()}
      onToggleDone={vi.fn()}
      canEdit
      pending={props.pending}
      edit={props.edit}
    />,
  );
}

describe.each([
  ['card', renderCard],
  ['row', renderRow],
] as const)('editing a %s in place', (_kind, renderIt) => {
  it('starts on a double-click of its words', () => {
    const props = edit();
    renderIt({ edit: props });
    fireEvent.doubleClick(screen.getByText('Call Müller'));
    expect(props.start).toHaveBeenCalledTimes(1);
  });

  it('starts on F2 while it has focus', () => {
    const props = edit();
    renderIt({ edit: props });
    const target = screen
      .getByText('Call Müller')
      .closest('[data-note-id] [role="button"], button, [role="button"]') as HTMLElement;
    fireEvent.keyDown(target, { key: 'F2' });
    expect(props.start).toHaveBeenCalledTimes(1);
  });

  it('starts on one click of the title under review, without opening the note', () => {
    const props = edit();
    const onOpen = vi.fn();
    renderIt({ edit: props, pending: pending(), onOpen });
    fireEvent.click(screen.getByText('Call Müller'));
    expect(props.start).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('draws the editor where it stood while editing, and no review', () => {
    renderIt({ edit: edit({ editing: true }), pending: pending() });
    expect(screen.getByRole('textbox', { name: 'Title of the note' })).toHaveValue('Call Müller');
    expect(screen.queryByRole('list', { name: 'Suggested fields' })).not.toBeInTheDocument();
    expect(document.querySelector('[data-note-id="n1"]')).not.toBeNull();
  });

  it('starts nothing without an edit (a viewer)', () => {
    const onOpen = vi.fn();
    renderIt({ edit: undefined as unknown as InlineEditProps, onOpen });
    fireEvent.doubleClick(screen.getByText('Call Müller'));
    expect(screen.queryByRole('textbox', { name: 'Title of the note' })).not.toBeInTheDocument();
  });
});
