import { z } from 'zod';
import { languageSchema } from '../enums.js';
import { userSummarySchema } from './user.js';

/**
 * The signed-in caller's own profile.
 *
 * Built by extending `userSummarySchema` so id/email/displayName cannot drift apart from the
 * embedded shape — but `language` is added HERE and must never move down into
 * `userSummarySchema` itself. That shape is embedded in *other people's* DTOs: a note's
 * assignee and createdBy, and every row of the members list. Carrying a language there would
 * ship every board member's UI preference to every other member, for no consumer at all, and
 * would widen three hot list responses to do it.
 *
 * `emailVerified` is deliberately absent too: the web already holds it reactively from
 * Firebase and renders the verification banner off that, so a server-side copy would be a
 * second source of truth for the same flag.
 */
export const meDtoSchema = userSummarySchema.extend({
  language: languageSchema,
});
export type MeDto = z.infer<typeof meDtoSchema>;

/** The only mutable field on a profile today — email and displayName are Firebase's to own. */
export const meUpdateSchema = z.object({
  language: languageSchema,
});
export type MeUpdateInput = z.infer<typeof meUpdateSchema>;
