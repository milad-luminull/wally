import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeNote } from '@/test/fixtures';
import { OPEN_AFTER_CLICK_MS, useInlineEdit } from './inlineEdit';

function setup(canEdit = true) {
  const onEdited = vi.fn();
  const onOpen = vi.fn();
  const hook = renderHook(() =>
    useInlineEdit({ boardId: 'b1', canEdit: () => canEdit, onEdited, onOpen }),
  );
  return { onEdited, onOpen, ...hook };
}

describe('useInlineEdit', () => {
  const a = makeNote({ id: 'a' });
  const b = makeNote({ id: 'b' });

  it('edits one note at a time', () => {
    const { result } = setup();
    act(() => result.current.editFor(a)!.start());
    expect(result.current.editFor(a)!.editing).toBe(true);
    act(() => result.current.editFor(b)!.start());
    expect(result.current.editFor(a)!.editing).toBe(false);
    expect(result.current.editFor(b)!.editing).toBe(true);
  });

  it('hands on a changed edit with its locks, and opens the sidebar on ⌘Enter', () => {
    const { result, onEdited, onOpen } = setup();
    act(() => result.current.editFor(a)!.start());
    act(() => result.current.editFor(a)!.done({ changed: true, open: true, locked: ['dueDate'] }));
    expect(result.current.editFor(a)!.editing).toBe(false);
    expect(onEdited).toHaveBeenCalledWith('a', ['dueDate']);
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('hands on nothing for Esc or unchanged words', () => {
    const { result, onEdited, onOpen } = setup();
    act(() => result.current.editFor(a)!.start());
    act(() => result.current.editFor(a)!.done(null));
    act(() => result.current.editFor(a)!.start());
    act(() => result.current.editFor(a)!.done({ changed: false, open: false, locked: [] }));
    expect(onEdited).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers no edit on a note the person may not edit', () => {
    const { result } = setup(false);
    expect(result.current.editFor(a)).toBeUndefined();
  });
});

describe('opening a card the person may edit', () => {
  const a = makeNote({ id: 'a' });

  it('waits out a double-click before it opens the sidebar', () => {
    vi.useFakeTimers();
    const { result, onOpen } = setup();
    act(() => result.current.openFromCard(a));
    expect(onOpen).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(OPEN_AFTER_CLICK_MS));
    expect(onOpen).toHaveBeenCalledWith('a');
    vi.useRealTimers();
  });

  it('never opens the sidebar when the second click starts an edit', () => {
    vi.useFakeTimers();
    const { result, onOpen } = setup();
    act(() => result.current.openFromCard(a));
    act(() => result.current.editFor(a)!.start());
    act(() => vi.advanceTimersByTime(OPEN_AFTER_CLICK_MS * 2));
    expect(onOpen).not.toHaveBeenCalled();
    expect(result.current.editFor(a)!.editing).toBe(true);
    vi.useRealTimers();
  });

  it('opens a note the person may not edit at once', () => {
    const { result, onOpen } = setup(false);
    act(() => result.current.openFromCard(a));
    expect(onOpen).toHaveBeenCalledWith('a');
  });
});
