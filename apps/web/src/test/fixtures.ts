import type { MemberDto, NoteDetailDto, NoteDto, WhiteboardDto } from '@wally/shared';

export function makeNote(overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    revision: 1,
    id: 'note-1',
    whiteboardId: 'board-1',
    title: 'Angebotsvergleich freigeben',
    description: '',
    status: 'OPEN',
    completedAt: null,
    priority: 'HOCH',
    horizon: 'HEUTE',
    freeX: 10,
    freeY: 20,
    dueDate: '2026-09-20',
    assignee: null,
    customFields: {},
    tags: [],
    colour: 'WEISS',
    subtaskSummary: { done: 0, total: 0 },
    createdBy: null,
    createdAt: '2026-09-10T10:00:00.000Z',
    updatedAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  };
}

export function makeNoteDetail(overrides: Partial<NoteDetailDto> = {}): NoteDetailDto {
  return {
    ...makeNote(),
    subtasks: [],
    history: [],
    ...overrides,
  };
}

export function makeMember(overrides: Partial<MemberDto> = {}): MemberDto {
  return {
    id: 'member-1',
    userId: 'user-1',
    email: 'nora.falk@example.com',
    displayName: 'Nora Falk',
    role: 'EDIT',
    status: 'ACTIVE',
    ...overrides,
  };
}

export function makeBoard(overrides: Partial<WhiteboardDto> = {}): WhiteboardDto {
  return {
    revision: 1,
    id: 'board-1',
    name: 'Meine Wand',
    ownerId: 'user-1',
    currentUserRole: 'OWNER',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}
