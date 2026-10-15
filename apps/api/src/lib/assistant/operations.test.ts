import { describe, expect, it } from 'vitest';
import {
  LIST_NOTES_MAX,
  operationAnnotations,
  operationInputs,
  operationNames,
  riskOf,
} from './operations.js';

const board = { boardId: 'board-1' };
const note = { boardId: 'board-1', noteId: 'note-1', expectedRevision: 3 };

describe('operation inputs', () => {
  it('names exactly the v1 surface', () => {
    expect([...operationNames].sort()).toEqual(
      [
        'add_subtask',
        'assign_note',
        'complete_note',
        'create_note',
        'delete_note',
        'get_note',
        'list_members',
        'list_notes',
        'move_note',
        'reopen_note',
        'toggle_subtask',
        'update_note',
      ].sort(),
    );
  });

  it('requires expectedRevision on every write to an existing note', () => {
    for (const name of [
      'update_note',
      'move_note',
      'complete_note',
      'reopen_note',
      'add_subtask',
      'toggle_subtask',
      'assign_note',
      'delete_note',
    ] as const) {
      const result = operationInputs[name].safeParse({ boardId: 'board-1', noteId: 'note-1' });
      expect(result.success, name).toBe(false);
    }
  });

  it('create_note takes no revision and accepts an empty input', () => {
    expect(operationInputs.create_note.safeParse({ ...board, input: {} }).success).toBe(true);
    expect(
      operationInputs.create_note.safeParse({ ...board, expectedRevision: 1, input: {} }).success,
    ).toBe(false);
  });

  it('update_note has no assignment field', () => {
    expect(
      operationInputs.update_note.safeParse({ ...note, input: { assigneeId: 'someone' } }).success,
    ).toBe(false);
    expect(operationInputs.update_note.safeParse({ ...note, input: { title: 'x' } }).success).toBe(
      true,
    );
  });

  it('list_notes bounds its limit and defaults it to the maximum', () => {
    expect(operationInputs.list_notes.parse(board).limit).toBe(LIST_NOTES_MAX);
    expect(operationInputs.list_notes.safeParse({ ...board, limit: 0 }).success).toBe(false);
    expect(
      operationInputs.list_notes.safeParse({ ...board, limit: LIST_NOTES_MAX + 1 }).success,
    ).toBe(false);
  });

  it('rejects unknown keys everywhere', () => {
    for (const name of operationNames) {
      const result = operationInputs[name].safeParse({ ...note, input: {}, extra: 1 });
      expect(result.success, name).toBe(false);
    }
  });
});

describe('operation annotations', () => {
  it('marks reads read-only and delete destructive', () => {
    expect(operationAnnotations.list_notes.readOnlyHint).toBe(true);
    expect(operationAnnotations.get_note.readOnlyHint).toBe(true);
    expect(operationAnnotations.list_members.readOnlyHint).toBe(true);
    expect(operationAnnotations.delete_note).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    });
    for (const name of operationNames) {
      if (name === 'delete_note') continue;
      expect(operationAnnotations[name].destructiveHint, name).toBe(false);
    }
  });
});

describe('riskOf', () => {
  const me = 'user-me';
  it('deleting is always a named confirm', () => {
    expect(riskOf('delete_note', note, me, { visibility: 'SHARED' })).toBe('DELETE');
  });
  it('assigning to someone else is a named confirm, to oneself or nobody is not', () => {
    expect(riskOf('assign_note', { ...note, input: { assigneeId: 'other' } }, me, null)).toBe(
      'ASSIGN_OTHER',
    );
    expect(riskOf('assign_note', { ...note, input: { assigneeId: me } }, me, null)).toBeNull();
    expect(riskOf('assign_note', { ...note, input: { assigneeId: null } }, me, null)).toBeNull();
    expect(riskOf('create_note', { ...board, input: { assigneeId: 'other' } }, me, null)).toBe(
      'ASSIGN_OTHER',
    );
    expect(riskOf('create_note', { ...board, input: {} }, me, null)).toBeNull();
  });
  it('making a private note shared is a named confirm', () => {
    expect(
      riskOf('update_note', { ...note, input: { visibility: 'SHARED' } }, me, {
        visibility: 'PRIVATE',
      }),
    ).toBe('MAKE_SHARED');
    expect(
      riskOf('update_note', { ...note, input: { visibility: 'SHARED' } }, me, {
        visibility: 'SHARED',
      }),
    ).toBeNull();
    expect(riskOf('update_note', { ...note, input: { title: 'x' } }, me, null)).toBeNull();
  });
});
