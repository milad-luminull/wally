import { z } from 'zod';

/**
 * These value sets must match the Prisma enums in apps/api/prisma/schema.prisma exactly
 * (backend has a parity test asserting this). Keep both in lockstep by hand.
 */

export const notePriorityValues = ['HOCH', 'MITTEL', 'NIEDRIG'] as const;
export const notePrioritySchema = z.enum(notePriorityValues);
export type NotePriority = z.infer<typeof notePrioritySchema>;

export const noteHorizonValues = ['HEUTE', 'DIESE_WOCHE', 'SPAETER'] as const;
export const noteHorizonSchema = z.enum(noteHorizonValues);
export type NoteHorizon = z.infer<typeof noteHorizonSchema>;

// Apricot is intentionally excluded — Finlex's design system reserves apricot for
// functional accents only (primary CTA, active-state, focus ring), never decoration.
export const noteColourValues = ['WEISS', 'EIS', 'SAND', 'MINZE', 'HIMMEL'] as const;
export const noteColourSchema = z.enum(noteColourValues);
export type NoteColour = z.infer<typeof noteColourSchema>;

export const noteStatusValues = ['OPEN', 'DONE'] as const;
export const noteStatusSchema = z.enum(noteStatusValues);
export type NoteStatus = z.infer<typeof noteStatusSchema>;

export const referenceTypeValues = ['KUNDE', 'VERTRAG', 'SCHADEN'] as const;
export const referenceTypeSchema = z.enum(referenceTypeValues);
export type ReferenceType = z.infer<typeof referenceTypeSchema>;

export const whiteboardRoleValues = ['VIEW', 'EDIT'] as const;
export const whiteboardRoleSchema = z.enum(whiteboardRoleValues);
export type WhiteboardRole = z.infer<typeof whiteboardRoleSchema>;

/** Synthetic role including the board owner, used for authorization checks and DTOs. */
export const effectiveRoleValues = ['OWNER', 'EDIT', 'VIEW'] as const;
export const effectiveRoleSchema = z.enum(effectiveRoleValues);
export type EffectiveRole = z.infer<typeof effectiveRoleSchema>;

export const membershipStatusValues = ['PENDING', 'ACTIVE'] as const;
export const membershipStatusSchema = z.enum(membershipStatusValues);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const noteHistoryEventTypeValues = ['CREATED', 'MOVED'] as const;
export const noteHistoryEventTypeSchema = z.enum(noteHistoryEventTypeValues);
export type NoteHistoryEventType = z.infer<typeof noteHistoryEventTypeSchema>;

export const noteMoveModeValues = ['HORIZON', 'PRIORITY', 'FREE'] as const;
export const noteMoveModeSchema = z.enum(noteMoveModeValues);
export type NoteMoveMode = z.infer<typeof noteMoveModeSchema>;
