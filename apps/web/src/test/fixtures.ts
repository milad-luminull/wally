import type { MemberDto, NoteDetailDto, NoteDto, WhiteboardDto } from '@wally/shared';
import type { SuggestionMark } from '@/features/board/Suggestions/useSuggestions';

export function makeNote(overrides: Partial<NoteDto> = {}): NoteDto {
  return {
    revision: 1,
    id: 'note-1',
    whiteboardId: 'board-1',
    title: 'Approve the quote comparison',
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
    links: [],
    colour: 'WEISS',
    visibility: 'SHARED',
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
    name: 'My Board',
    ownerId: 'user-1',
    currentUserRole: 'OWNER',
    assistantEnabled: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeSuggestionMark(overrides: Partial<SuggestionMark> = {}): SuggestionMark {
  return {
    phase: 'pending',
    suggestion: {
      id: 's1',
      boardId: 'board-1',
      noteId: 'note-1',
      status: 'PENDING',
      baseRevision: 1,
      fields: {
        dueDate: { value: '2026-10-23', reason: 'Friday' },
        priority: { value: 'HOCH', reason: 'urgent' },
        assignee: {
          value: { id: 'u-anna', email: 'anna@example.com', displayName: 'Anna' },
          reason: 'Anna',
        },
        title: null,
        reference: null,
        subtasks: null,
        links: null,
      },
      typed: [],
      kept: null,
      createdAt: '2026-10-17T10:00:00.000Z',
    },
    fields: ['dueDate', 'priority', 'assignee'],
    subtasks: [],
    links: [],
    titleDismissed: false,
    countdownEndsAt: Date.now() + 6000,
    countdownMs: 6000,
    paused: false,
    ...overrides,
  };
}
