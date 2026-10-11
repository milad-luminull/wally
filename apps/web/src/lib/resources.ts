import { z } from 'zod';
import {
  meDtoSchema,
  meUpdateSchema,
  whiteboardDtoSchema,
  whiteboardSummaryDtoSchema,
  noteDtoSchema,
  noteDetailDtoSchema,
  noteCreateSchema,
  noteUpdateSchema,
  noteMoveSchema,
  noteAssignSchema,
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
  rename: (boardId: string, name: string): Promise<WhiteboardDto> =>
    api.patch(`/whiteboards/${boardId}`, { name }, whiteboardDtoSchema),
};

/**
 * The write routes (`create`, `update`, `move`, `assign`, `complete`, `reopen`) answer with
 * the LIST-shaped note — see apps/api/src/routes/notes.ts, which returns `toNoteDto` from
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
  update: (noteId: string, input: NoteUpdateInput): Promise<NoteDto> =>
    api.patch(`/notes/${noteId}`, noteUpdateSchema.parse(input), noteDtoSchema),
  move: (noteId: string, input: NoteMoveInput): Promise<NoteDto> =>
    api.post(`/notes/${noteId}/move`, noteMoveSchema.parse(input), noteDtoSchema),
  assign: (noteId: string, assigneeId: string | null): Promise<NoteDto> =>
    api.post(`/notes/${noteId}/assign`, noteAssignSchema.parse({ assigneeId }), noteDtoSchema),
  complete: (noteId: string): Promise<NoteDto> =>
    api.post(`/notes/${noteId}/complete`, {}, noteDtoSchema),
  reopen: (noteId: string): Promise<NoteDto> =>
    api.post(`/notes/${noteId}/reopen`, {}, noteDtoSchema),
  remove: (noteId: string): Promise<void> => api.delete(`/notes/${noteId}`),
};

export const subtasksApi = {
  create: (noteId: string, input: SubtaskCreateInput): Promise<SubtaskDto> =>
    api.post(`/notes/${noteId}/subtasks`, subtaskCreateSchema.parse(input), subtaskDtoSchema),
  update: (noteId: string, subtaskId: string, input: SubtaskUpdateInput): Promise<SubtaskDto> =>
    api.patch(
      `/notes/${noteId}/subtasks/${subtaskId}`,
      subtaskUpdateSchema.parse(input),
      subtaskDtoSchema,
    ),
  remove: (noteId: string, subtaskId: string): Promise<void> =>
    api.delete(`/notes/${noteId}/subtasks/${subtaskId}`),
};

export const membersApi = {
  list: (boardId: string): Promise<MemberDto[]> =>
    api.get(`/whiteboards/${boardId}/members`, memberListSchema),
  invite: (boardId: string, input: InviteCreateInput): Promise<MemberDto> =>
    api.post(
      `/whiteboards/${boardId}/members/invite`,
      inviteCreateSchema.parse(input),
      memberDtoSchema,
    ),
  updateRole: (
    boardId: string,
    memberId: string,
    input: MemberRoleUpdateInput,
  ): Promise<MemberDto> =>
    api.patch(
      `/whiteboards/${boardId}/members/${memberId}`,
      memberRoleUpdateSchema.parse(input),
      memberDtoSchema,
    ),
  remove: (boardId: string, memberId: string): Promise<void> =>
    api.delete(`/whiteboards/${boardId}/members/${memberId}`),
};

export const shareLinkApi = {
  get: (boardId: string): Promise<ShareLinkDto> =>
    api.get(`/whiteboards/${boardId}/share-link`, shareLinkDtoSchema),
  createOrUpdate: (boardId: string, role: WhiteboardRole): Promise<ShareLinkDto> =>
    api.post(
      `/whiteboards/${boardId}/share-link`,
      shareLinkRoleSchema.parse({ role }),
      shareLinkDtoSchema,
    ),
  /** The route declares params only, so the body is empty — same shape as notesApi's
   *  body-less POSTs. Tokens are base64url, so they need no escaping. */
  redeem: (token: string): Promise<ShareLinkRedeemResult> =>
    api.post(`/share-links/${token}/redeem`, {}, shareLinkRedeemResultSchema),
};
