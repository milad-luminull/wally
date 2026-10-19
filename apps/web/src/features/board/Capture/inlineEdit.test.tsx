import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { makeNote } from '@/test/fixtures';
import { useInlineEdit } from './inlineEdit';

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
    act(() => result.current(a)!.start());
    expect(result.current(a)!.editing).toBe(true);
    act(() => result.current(b)!.start());
    expect(result.current(a)!.editing).toBe(false);
    expect(result.current(b)!.editing).toBe(true);
  });

  it('hands on a changed edit with its locks, and opens the sidebar on ⌘Enter', () => {
    const { result, onEdited, onOpen } = setup();
    act(() => result.current(a)!.start());
    act(() => result.current(a)!.done({ changed: true, open: true, locked: ['dueDate'] }));
    expect(result.current(a)!.editing).toBe(false);
    expect(onEdited).toHaveBeenCalledWith('a', ['dueDate']);
    expect(onOpen).toHaveBeenCalledWith('a');
  });

  it('hands on nothing for Esc or unchanged words', () => {
    const { result, onEdited, onOpen } = setup();
    act(() => result.current(a)!.start());
    act(() => result.current(a)!.done(null));
    act(() => result.current(a)!.start());
    act(() => result.current(a)!.done({ changed: false, open: false, locked: [] }));
    expect(onEdited).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers no edit on a note the person may not edit', () => {
    const { result } = setup(false);
    expect(result.current(a)).toBeUndefined();
  });
});
