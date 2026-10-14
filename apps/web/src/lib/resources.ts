import { z } from 'zod';
import {
  meDtoSchema,
  meUpdateSchema,
  whiteboardCreateSchema,
  whiteboardDtoSchema,
  whiteboardSummaryDtoSchema,
  noteDtoSchema,
  noteDetailDtoSchema,
  noteCreateSchema,
  noteUpdateSchema,
  noteMoveSchema,
  noteAssignSchema,
  noteDuplicateSchema,
  memberDtoSchema,
  inviteCreateSchema,
  memberRoleUpdateSchema,
  shareLinkDtoSchema,
  shareLinkRoleSchema,
  shareLinkRedeemResultSchema,
  subtaskDtoSchema,
  subtaskCreateSchema,
  subtaskUpdateSchema,
  type Language,
  type MeDto,
  type WhiteboardDto,
  type WhiteboardSummaryDto,
  type NoteDto,
  type NoteDetailDto,
  type NoteCreateInput,
  type NoteUpdateInput,
  type NoteMoveInput,
  type NoteDuplicateInput,
  type NoteListQuery,
  type PreferencesUpdate,
  type MemberDto,
  type InviteCreateInput,
  type MemberRoleUpdateInput,
  type ShareLinkDto,
  type ShareLinkRedeemResult,
  type SubtaskDto,
  type SubtaskCreateInput,
  type SubtaskUpdateInput,
  type WhiteboardRole,
} from '@wally/shared';
import { api } from './apiClient';
import type { MutationTicket } from './mutationQueue';

const noteListSchema = z.array(noteDtoSchema);
const memberListSchema = z.array(memberDtoSchema);
const whiteboardListSchema = z.array(whiteboardSummaryDtoSchema);

export const meApi = {
  get: (): Promise<MeDto> => api.get('/me', meDtoSchema),
  updateLanguage: (language: Language): Promise<MeDto> =>
    api.patch('/me', meUpdateSchema.parse({ language }), meDtoSchema),
  updatePreferences: (preferences: PreferencesUpdate): Promise<MeDto> =>
    api.patch('/me', meUpdateSchema.parse({ preferences }), meDtoSchema),
};

export const boardsApi = {
  list: (): Promise<WhiteboardSummaryDto[]> => api.get('/whiteboards', whiteboardListSchema),
  get: (boardId: string): Promise<WhiteboardDto> =>
    api.get(`/whiteboards/${boardId}`, whiteboardDtoSchema),
  rename: (boardId: string, name: string, ticket?: MutationTicket): Promise<WhiteboardDto> =>
    api.patch(`/whiteboards/${boardId}`, { name }, whiteboardDtoSchema, ticket),
  /** No lane and no recovery entry: the New board dialog reports its own errors. */
  create: (name: string, ticket?: MutationTicket): Promise<WhiteboardDto> =>
    api.post('/whiteboards', whiteboardCreateSchema.parse({ name }), whiteboardDtoSchema, ticket),
  /** Owner only, against the board revision. A 404 means already gone and resolves. */
  remove: (boardId: string, ticket?: MutationTicket): Promise<void> =>
    api.delete(`/whiteboards/${boardId}`, undefined, ticket),
  /** No revision: leaving states a fact about the caller. A 404 means already gone. */
  leave: (boardId: string): Promise<void> => api.post(`/whiteboards/${boardId}/leave`, {}),
};

/**
 * The write routes (`create`, `update`, `move`, `assign`, `complete`, `reopen`) answer with
 * the LIST-shaped note — see apps/api/src/lib/commands/notes.ts, which returns `toNoteDto` from
 * all of them and `toNoteDetailDto` only from `GET /notes/:id`. Declaring them as
 * `noteDetailDtoSchema` made every one of those calls fail response validation on a 200
 * ("subtasks: Required, history: Required"), which surfaced as an optimistic update being
 * rolled back by `onError` and then re-applied by the settling refetch — the note visibly
 * bounced back to where it came from after a successful drag.
 *
 * `noteDtoSchema` is also the forward-compatible choice: Zod objects strip unknown keys, so
 * it keeps validating if these routes ever start returning the fuller detail payload.
 */
export const notesApi = {
  list: (boardId: string, query: Partial<NoteListQuery> = {}): Promise<NoteDto[]> =>
    api.get(`/whiteboards/${boardId}/notes`, noteListSchema, {
      q: query.q,
      priority: query.priority?.join(','),
      horizon: query.horizon?.join(','),
      assignedToMe: query.assignedToMe,
      status: query.status,
    }),
  get: (noteId: string): Promise<NoteDetailDto> => api.get(`/notes/${noteId}`, noteDetailDtoSchema),
  create: (boardId: string, input: Partial<NoteCreateInput>): Promise<NoteDto> =>
    api.post(`/whiteboards/${boardId}/notes`, noteCreateSchema.parse(input), noteDtoSchema),
  update: (noteId: string, input: NoteUpdateInput, ticket?: MutationTicket): Promise<NoteDto> =>
    api.patch(`/notes/${noteId}`, noteUpdateSchema.parse(input), noteDtoSchema, ticket),
  move: (noteId: string, input: NoteMoveInput, ticket?: MutationTicket): Promise<NoteDto> =>
    api.post(`/notes/${noteId}/move`, noteMoveSchema.parse(input), noteDtoSchema, ticket),
  duplicate: (
    noteId: string,
    input: NoteDuplicateInput,
    ticket?: MutationTicket,
  ): Promise<NoteDto> =>
    api.post(`/notes/${noteId}/duplicate`, noteDuplicateSchema.parse(input), noteDtoSchema, ticket),
  assign: (noteId: string, assigneeId: string | null, ticket?: MutationTicket): Promise<NoteDto> =>
    api.post(
      `/notes/${noteId}/assign`,
      noteAssignSchema.parse({ assigneeId }),
      noteDtoSchema,
      ticket,
    ),
  complete: (noteId: string, ticket?: MutationTicket): Promise<NoteDto> =>
    api.post(`/notes/${noteId}/complete`, {}, noteDtoSchema, ticket),
  reopen: (noteId: string, ticket?: MutationTicket): Promise<NoteDto> =>
    api.post(`/notes/${noteId}/reopen`, {}, noteDtoSchema, ticket),
  remove: (noteId: string, ticket?: MutationTicket): Promise<void> =>
    api.delete(`/notes/${noteId}`, undefined, ticket),
};

export const subtasksApi = {
  create: (
    noteId: string,
    input: SubtaskCreateInput,
    ticket?: MutationTicket,
  ): Promise<SubtaskDto> =>
    api.post(
      `/notes/${noteId}/subtasks`,
      subtaskCreateSchema.parse(input),
      subtaskDtoSchema,
      ticket,
    ),
  update: (
    noteId: string,
    subtaskId: string,
    input: SubtaskUpdateInput,
    ticket?: MutationTicket,
  ): Promise<SubtaskDto> =>
    api.patch(
      `/notes/${noteId}/subtasks/${subtaskId}`,
      subtaskUpdateSchema.parse(input),
      subtaskDtoSchema,
      ticket,
    ),
  remove: (noteId: string, subtaskId: string, ticket?: MutationTicket): Promise<void> =>
    api.delete(`/notes/${noteId}/subtasks/${subtaskId}`, undefined, ticket),
};

export const membersApi = {
  list: (boardId: string): Promise<MemberDto[]> =>
    api.get(`/whiteboards/${boardId}/members`, memberListSchema),
  invite: (
    boardId: string,
    input: InviteCreateInput,
    ticket?: MutationTicket,
  ): Promise<MemberDto> =>
    api.post(
      `/whiteboards/${boardId}/members/invite`,
      inviteCreateSchema.parse(input),
      memberDtoSchema,
      ticket,
    ),
  updateRole: (
    boardId: string,
    memberId: string,
    input: MemberRoleUpdateInput,
    ticket?: MutationTicket,
  ): Promise<MemberDto> =>
    api.patch(
      `/whiteboards/${boardId}/members/${memberId}`,
      memberRoleUpdateSchema.parse(input),
      memberDtoSchema,
      ticket,
    ),
  remove: (boardId: string, memberId: string, ticket?: MutationTicket): Promise<void> =>
    api.delete(`/whiteboards/${boardId}/members/${memberId}`, undefined, ticket),
};

export const shareLinkApi = {
  get: (boardId: string): Promise<ShareLinkDto> =>
    api.get(`/whiteboards/${boardId}/share-link`, shareLinkDtoSchema),
  createOrUpdate: (
    boardId: string,
    role: WhiteboardRole,
    exists = false,
    ticket?: MutationTicket,
  ): Promise<ShareLinkDto> =>
    api[exists ? 'patch' : 'post'](
      `/whiteboards/${boardId}/share-link`,
      shareLinkRoleSchema.parse({ role }),
      shareLinkDtoSchema,
      ticket,
    ),
  rotate: (boardId: string): Promise<ShareLinkDto> =>
    api.post(`/whiteboards/${boardId}/share-link/rotate`, {}, shareLinkDtoSchema),
  remove: (boardId: string): Promise<void> => api.delete(`/whiteboards/${boardId}/share-link`),
  /** The route declares params only, so the body is empty — same shape as notesApi's
   *  body-less POSTs. Tokens are base64url, so they need no escaping. */
  redeem: (token: string): Promise<ShareLinkRedeemResult> =>
    api.post(`/share-links/${token}/redeem`, {}, shareLinkRedeemResultSchema),
};
