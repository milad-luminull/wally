import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/resources', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/resources')>()),
  membersApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/i18n/languageContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/languageContext')>();
  return {
    ...actual,
    useLanguage: () => ({
      language: 'en',
      setLanguage: vi.fn(),
      isSaving: false,
      saveFailed: false,
    }),
  };
});

import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import type { BoxReply, WallyBoxController } from './useWallyBox';
import { WallyBox } from './WallyBox';

const placement = { kind: 'free', x: 10, y: 20 } as const;

function controller(over: Partial<WallyBoxController> = {}): WallyBoxController {
  return {
    pending: [],
    reply: null,
    working: false,
    send: vi.fn(),
    choose: vi.fn(),
    closeReply: vi.fn(),
    ...over,
  };
}

function renderBox(
  box = controller(),
  {
    assistantEnabled = true,
    mode = 'docked' as 'docked' | 'anchored',
    onDismiss = vi.fn(),
    onOpenNote = vi.fn(),
  } = {},
) {
  renderWithProviders(
    <WallyBox
      boardId="b1"
      box={box}
      mode={mode}
      assistantEnabled={assistantEnabled}
      notes={[makeNote({ id: 'n9', title: 'Call Andrea' })]}
      placement={placement}
      visibility="SHARED"
      onOpenNote={onOpenNote}
      onDismiss={onDismiss}
    />,
  );
  return {
    box,
    onDismiss,
    onOpenNote,
    field: screen.getByRole('textbox', { name: 'Write a note or ask Wally' }),
  };
}

describe('WallyBox', () => {
  it('shows the hint only with text and the assistant on', async () => {
    const { field } = renderBox();
    expect(screen.queryByText('Adds a note')).toBeNull();
    await userEvent.type(field, 'call irem wed');
    expect(screen.getByText('Adds a note')).toBeVisible();
    await userEvent.clear(field);
    await userEvent.type(field, 'what is blocking munich');
    expect(screen.getByText('Asks Wally')).toBeVisible();
  });

  it('no hint and the notes-only placeholder with the assistant off', async () => {
    renderWithProviders(
      <WallyBox
        boardId="b1"
        box={controller()}
        mode="docked"
        assistantEnabled={false}
        notes={[]}
        placement={placement}
        visibility="SHARED"
        onOpenNote={vi.fn()}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Write a note or ask Wally' });
    expect(field).toHaveAttribute('placeholder', 'Write a note…');
    await userEvent.type(field, 'what is due?');
    expect(screen.queryByText('Asks Wally')).toBeNull();
    expect(screen.queryByText('Adds a note')).toBeNull();
  });

  it('Tab flips the hint and pins it', async () => {
    const { field, box } = renderBox();
    await userEvent.type(field, 'call irem wed');
    await userEvent.tab();
    expect(field).toHaveFocus();
    expect(screen.getByText('Asks Wally')).toBeVisible();
    await userEvent.keyboard('{Enter}');
    expect(box.send).toHaveBeenCalledWith(
      'call irem wed',
      expect.objectContaining({ pinned: 'ask' }),
    );
  });

  it('Tab on an empty box leaves focus to the browser', async () => {
    const { field } = renderBox();
    field.focus();
    await userEvent.tab();
    expect(field).not.toHaveFocus();
  });

  it('Enter sends and clears at once', async () => {
    const { field, box } = renderBox();
    await userEvent.type(field, 'call irem wed{Enter}');
    expect(box.send).toHaveBeenCalledWith(
      'call irem wed',
      expect.objectContaining({ pinned: null, placement, open: false }),
    );
    expect(field).toHaveValue('');
  });

  it('Shift+Enter makes a new line', async () => {
    const { field, box } = renderBox();
    await userEvent.type(field, 'one{Shift>}{Enter}{/Shift}two');
    expect(field).toHaveValue('one\ntwo');
    expect(box.send).not.toHaveBeenCalled();
  });

  it('pending chips show the first words', () => {
    renderBox(controller({ pending: [{ id: 'm1', text: 'dentist thu 8am' }], working: true }));
    expect(screen.getByLabelText('Working on: dentist thu 8am')).toBeVisible();
  });

  it('an answer shows the notes read and × closes it', async () => {
    const reply: BoxReply = {
      kind: 'answer',
      question: 'What is blocking munich?',
      outcome: {
        kind: 'answered',
        conversation: {
          id: 'c1',
          boardId: 'b1',
          status: 'OPEN',
          model: 'm',
          entries: [
            {
              role: 'assistant',
              text: 'Call Andrea waits on the offer.',
              chips: [{ id: 'n9', title: 'Call Andrea' }],
              partial: false,
              stopped: null,
              at: new Date().toISOString(),
            },
          ],
        },
      },
    };
    const { box, onOpenNote } = renderBox(controller({ reply }));
    expect(screen.getByText('Call Andrea waits on the offer.')).toBeVisible();
    expect(screen.getByText('Notes read')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Call Andrea/ }));
    expect(onOpenNote).toHaveBeenCalledWith('n9');
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(box.closeReply).toHaveBeenCalled();
  });

  it('a duplicate offers Open it and Add anyway', async () => {
    const reply: BoxReply = {
      kind: 'duplicate',
      text: 'update the premium table',
      note: { id: 'n7', title: 'Update premium table to v2' },
    };
    const { box } = renderBox(controller({ reply }));
    expect(screen.getByText('You already have “Update premium table to v2”.')).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(box.choose).toHaveBeenCalledWith({ action: 'open', noteId: 'n7' });
    await userEvent.click(screen.getByRole('button', { name: 'Add anyway' }));
    expect(box.choose).toHaveBeenCalledWith({
      action: 'addAnyway',
      text: 'update the premium table',
    });
  });

  it('Esc closes the reply first, then dismisses the anchored box', async () => {
    const reply: BoxReply = { kind: 'status', message: 'savedAsWritten' };
    const box = controller({ reply });
    const { field, onDismiss } = renderBox(box, { mode: 'anchored' });
    field.focus();
    await userEvent.keyboard('{Escape}');
    expect(box.closeReply).toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Esc on an empty anchored box with no reply dismisses it', async () => {
    const { field, onDismiss } = renderBox(controller(), { mode: 'anchored' });
    field.focus();
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalled();
  });
});
