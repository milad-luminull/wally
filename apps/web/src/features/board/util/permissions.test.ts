import { describe, expect, it } from 'vitest';
import { makeNote } from '@/test/fixtures';
import { boardAccess } from './permissions';

const me = { id: 'me', email: 'me@example.com', displayName: 'Me' };
const other = { id: 'other', email: 'o@example.com', displayName: 'Other' };
const sharedByMe = makeNote({ createdBy: me });
const sharedByOther = makeNote({ createdBy: other });
const privateMine = makeNote({ visibility: 'PRIVATE', createdBy: me, assignee: me });

describe('boardAccess', () => {
  it('lets an editor edit every note and switch only their own', () => {
    const a = boardAccess('EDIT', 'me', 'all');
    expect(a.newNoteVisibility).toBe('SHARED');
    expect([sharedByMe, sharedByOther, privateMine].map(a.canEditNote)).toEqual([true, true, true]);
    expect([sharedByMe, sharedByOther, privateMine].map(a.showsVisibilitySwitch)).toEqual([
      true,
      false,
      true,
    ]);
  });

  it('creates private notes while "Only private" is on', () => {
    expect(boardAccess('OWNER', 'me', 'private').newNoteVisibility).toBe('PRIVATE');
    expect(boardAccess('OWNER', 'me', 'shared').newNoteVisibility).toBe('SHARED');
  });

  it('gives a viewer their own private notes and nothing else', () => {
    const a = boardAccess('VIEW', 'me', 'all');
    expect(a.canEditShared).toBe(false);
    expect(a.newNoteVisibility).toBe('PRIVATE');
    expect([sharedByMe, sharedByOther, privateMine].map(a.canEditNote)).toEqual([
      false,
      false,
      true,
    ]);
    // Shown on their private note so the disabled switch can explain why; absent elsewhere.
    expect([sharedByMe, sharedByOther, privateMine].map(a.showsVisibilitySwitch)).toEqual([
      false,
      false,
      true,
    ]);
  });
});
