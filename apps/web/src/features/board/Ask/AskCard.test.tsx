import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AssistantEntry } from '@wally/shared';
import { renderWithProviders } from '@/test/renderWithProviders';
import { makeNote } from '@/test/fixtures';
import { AskCard } from './AskCard';
import type { AskSession } from './useAskSession';

const AT = '2026-10-17T10:00:00.000Z';
const answer = (overrides: Partial<AssistantEntry> = {}): AssistantEntry => ({
  role: 'assistant',
  text: 'Two notes are open.',
  chips: [{ id: 'n1', title: 'Call Müller' }],
  partial: false,
  stopped: null,
  at: AT,
  ...overrides,
});
const session = (overrides: Partial<AskSession> = {}): AskSession => ({
  id: 1,
  placement: { kind: 'free', x: 10, y: 20 },
  question: 'What is open today?',
  phase: 'answered',
  answer: answer(),
  refusal: null,
  pinned: false,
  paused: false,
  takeFocus: true,
  ...overrides,
});

function renderCard(s: AskSession, props: Partial<Parameters<typeof AskCard>[0]> = {}) {
  const handlers = {
    onOpenNote: vi.fn(),
    onSetPinned: vi.fn(),
    onDismiss: vi.fn(),
    onPause: vi.fn(),
    ...props,
  };
  const view = renderWithProviders(
    <AskCard
      session={s}
      notes={[makeNote({ id: 'n1', title: 'Call Müller' })]}
      layout="card"
      {...handlers}
    />,
  );
  return { ...handlers, view };
}

describe('AskCard', () => {
  it('shows the question and a busy body while asking', () => {
    renderCard(session({ phase: 'asking', answer: null }));
    const card = screen.getByRole('group', { name: 'Answer from the wall' });
    expect(card).toHaveTextContent('What is open today?');
    expect(card).toHaveAttribute('data-ask-phase', 'asking');
    expect(screen.getByText('Reading the wall')).toBeInTheDocument();
    expect(card.querySelector('[aria-live="polite"]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the answer, its stopped and partial lines and the notes read as rows', () => {
    renderCard(session({ answer: answer({ stopped: 'LENGTH', partial: true }) }));
    expect(screen.getByText('Two notes are open.')).toBeInTheDocument();
    expect(screen.getByText('The answer was cut short.')).toBeInTheDocument();
    expect(screen.getByText('Only part of the matching notes was read.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Call Müller/ })).toBeInTheDocument();
    const card = screen.getByRole('group', { name: 'Answer from the wall' });
    expect(card).toHaveClass('border-dashed');
    expect(card.querySelector('svg.fill-accent, .stroke-accent')).toBeNull();
  });

  it('a click on a row pins the card and opens the note', async () => {
    const { onOpenNote, onSetPinned } = renderCard(session());
    await userEvent.click(screen.getByRole('button', { name: /Call Müller/ }));
    expect(onSetPinned).toHaveBeenCalledWith(true);
    expect(onOpenNote).toHaveBeenCalledWith('n1');
  });

  it('the pin toggles and says which way it is', async () => {
    const { onSetPinned, view } = renderCard(session());
    const pin = screen.getByRole('button', { name: 'Pin the answer' });
    expect(pin).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(pin);
    expect(onSetPinned).toHaveBeenCalledWith(true);
    view.rerender(
      <AskCard
        session={session({ pinned: true })}
        notes={[]}
        layout="card"
        onOpenNote={vi.fn()}
        onSetPinned={onSetPinned}
        onDismiss={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Unpin the answer' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('Esc and the × dismiss; Esc does not reach the board', async () => {
    const outer = vi.fn();
    const onDismiss = vi.fn();
    renderWithProviders(
      <div onKeyDown={outer}>
        <AskCard
          session={session()}
          notes={[]}
          layout="card"
          onOpenNote={vi.fn()}
          onSetPinned={vi.fn()}
          onDismiss={onDismiss}
          onPause={vi.fn()}
        />
      </div>,
    );
    const card = screen.getByRole('group', { name: 'Answer from the wall' });
    card.focus();
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close the answer' }));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('a single key on the focused card never reaches the board shortcuts', async () => {
    const outer = vi.fn();
    renderWithProviders(
      <div onKeyDown={outer}>
        <AskCard
          session={session()}
          notes={[]}
          layout="card"
          onOpenNote={vi.fn()}
          onSetPinned={vi.fn()}
          onDismiss={vi.fn()}
          onPause={vi.fn()}
        />
      </div>,
    );
    screen.getByRole('group', { name: 'Answer from the wall' }).focus();
    await userEvent.keyboard('n');
    expect(outer).not.toHaveBeenCalled();
  });

  it('hover and focus hold the clock; leaving both lets go once', async () => {
    const { onPause } = renderCard(session());
    const card = screen.getByRole('group', { name: 'Answer from the wall' });
    fireEvent.mouseEnter(card);
    expect(onPause).toHaveBeenLastCalledWith(true);
    act(() => screen.getByRole('button', { name: 'Pin the answer' }).focus());
    fireEvent.mouseLeave(card);
    expect(onPause).toHaveBeenCalledTimes(1);
    await userEvent.tab();
    await userEvent.tab();
    fireEvent.blur(card, { relatedTarget: document.body });
    expect(onPause).toHaveBeenLastCalledWith(false);
  });

  it('a refusal says when it resets, in the reader’s locale; a failure says so', () => {
    const { view } = renderCard(
      session({
        phase: 'refused',
        answer: null,
        refusal: { code: 'ASSISTANT_DAILY_CAP', resetsAt: AT },
      }),
    );
    expect(
      screen.getByText(/Daily limit reached\. Available again from .*2026/),
    ).toBeInTheDocument();
    view.rerender(
      <AskCard
        session={session({
          phase: 'refused',
          answer: null,
          refusal: { code: 'ASSISTANT_BUSY', resetsAt: null },
        })}
        notes={[]}
        layout="card"
        onOpenNote={vi.fn()}
        onSetPinned={vi.fn()}
        onDismiss={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    expect(screen.getByText('Busy right now. Try again in a moment.')).toBeInTheDocument();
    view.rerender(
      <AskCard
        session={session({ phase: 'failed', answer: null })}
        notes={[]}
        layout="card"
        onOpenNote={vi.fn()}
        onSetPinned={vi.fn()}
        onDismiss={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    expect(screen.getByText('No answer. Try again.')).toBeInTheDocument();
  });

  it('takes the focus on mount when it lies on the page, and leaves a focused field alone', () => {
    renderCard(session());
    expect(screen.getByRole('group', { name: 'Answer from the wall' })).toHaveFocus();
    document.body.innerHTML = '';
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    renderCard(session({ id: 2 }));
    expect(input).toHaveFocus();
  });

  it('takes no focus on mount for a question asked by a blur', () => {
    (document.activeElement as HTMLElement | null)?.blur();
    const first = renderCard(session({ takeFocus: false }));
    expect(screen.getByRole('group', { name: 'Answer from the wall' })).not.toHaveFocus();
    expect(document.activeElement).toBe(document.body);
    first.view.unmount();

    // A click on the wall put the focus on the board surface: it stays there.
    const surface = document.createElement('div');
    surface.setAttribute('data-board-surface', '');
    surface.tabIndex = -1;
    document.body.append(surface);
    surface.focus();
    renderCard(session({ id: 2, takeFocus: false }));
    expect(surface).toHaveFocus();
    surface.remove();
  });

  it('the focus it takes on mount does not hold the clock; focus the person moves in does', () => {
    // The focus lies on the page, as the capture card leaves it (an earlier case leaves a field).
    (document.activeElement as HTMLElement | null)?.blur();
    const { onPause } = renderCard(session());
    expect(screen.getByRole('group', { name: 'Answer from the wall' })).toHaveFocus();
    expect(onPause).not.toHaveBeenCalled();
    act(() => screen.getByRole('button', { name: 'Pin the answer' }).focus());
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onPause).toHaveBeenLastCalledWith(true);
  });

  it('hands the focus to the board surface when it goes with the focus inside', () => {
    const surface = document.createElement('div');
    surface.setAttribute('data-board-surface', '');
    surface.tabIndex = -1;
    document.body.append(surface);
    const { view } = renderCard(session());
    act(() => screen.getByRole('button', { name: 'Pin the answer' }).focus());
    view.unmount();
    expect(surface).toHaveFocus();
    surface.remove();
  });

  it('fades out when told to, and is a full-width row in the list', () => {
    const { view } = renderCard(session({ phase: 'fading' }));
    expect(screen.getByRole('group', { name: 'Answer from the wall' })).toHaveClass(
      'animate-fade-out',
    );
    view.rerender(
      <AskCard
        session={session()}
        notes={[]}
        layout="row"
        onOpenNote={vi.fn()}
        onSetPinned={vi.fn()}
        onDismiss={vi.fn()}
        onPause={vi.fn()}
      />,
    );
    expect(screen.getByRole('group', { name: 'Answer from the wall' })).toHaveClass('w-full');
  });
});
