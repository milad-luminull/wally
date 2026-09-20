import { z } from 'zod';
import { FIELD_KEY_MAX_LENGTH, FIELD_VALUE_MAX_LENGTH, MAX_FIELDS_PER_NOTE } from '../constants.js';

/**
 * Free-form key/value properties on a note ("Kunde: Müller GmbH", "Vertragsnr: 4711"),
 * replacing the old fixed Bezug field.
 *
 * Stored as a MAP rather than an array of {key, value} objects. Firestore auto-indexes map
 * subfields, so `where('customFields.Kunde', '==', 'Müller GmbH')` stays available without a
 * composite index; nothing inside an array of objects is queryable at all. The note list
 * route filters in memory today, so nothing depends on that yet — it just keeps the door
 * open. (The flip side: free-form keys mean unbounded auto-indexed field paths. If that ever
 * bites, exempt `notes.customFields` via a fieldOverrides entry in firestore.indexes.json.)
 */

/**
 * Keys are stored as typed — German capitalisation carries meaning ("Vertragsnr") — but
 * trimmed, with runs of inner whitespace collapsed.
 *
 * The rejected characters are Firestore field-path metacharacters. Storing a key containing
 * one would make the map subfield unaddressable in a query without escaping, so they are
 * refused at the edge instead.
 */
export const customFieldKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(FIELD_KEY_MAX_LENGTH)
  .transform((key) => key.replace(/\s+/g, ' '))
  .refine((key) => !/[.[\]*/`~]/.test(key), {
    message: 'Field name may not contain . [ ] * / ` or ~',
  })
  .refine((key) => !/^__.*__$/.test(key), { message: 'Field name is reserved' });

export const customFieldValueSchema = z.string().trim().min(1).max(FIELD_VALUE_MAX_LENGTH);

export const customFieldsSchema = z
  .record(customFieldKeySchema, customFieldValueSchema)
  .default({})
  .superRefine((fields, ctx) => {
    const keys = Object.keys(fields);
    if (keys.length > MAX_FIELDS_PER_NOTE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A note may carry at most ${MAX_FIELDS_PER_NOTE} properties`,
      });
    }
    // "Kunde" and "kunde" are the same property to a reader, and letting both exist would
    // show two rows that overwrite each other unpredictably.
    const seen = new Set<string>();
    for (const key of keys) {
      const folded = normalizeFieldKey(key).toLocaleLowerCase('de');
      if (seen.has(folded)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate property name: ${key}`,
        });
      }
      seen.add(folded);
    }
  });

export type CustomFields = Record<string, string>;

/** Trim + collapse inner whitespace. Mirrors what customFieldKeySchema stores. */
export function normalizeFieldKey(key: string): string {
  return key.trim().replace(/\s+/g, ' ');
}

/**
 * The existing key matching `key` case-insensitively, or undefined. Used so editing
 * "kunde" overwrites the existing "Kunde" rather than creating a near-duplicate.
 */
/**
 * The 'de' fold below is case folding for DATA INTEGRITY, not display ordering, and it stays
 * hardcoded on purpose — do not "finish the i18n job" by making it follow the caller's
 * language. Field keys are stored, shared board state: a per-caller fold would mean
 * {Kunde: 'A', kunde: 'B'} is a duplicate for one member and legal for another, and that the
 * same note resolves to a different key depending on who is editing it.
 */
export function findFieldKey(fields: CustomFields, key: string): string | undefined {
  const folded = normalizeFieldKey(key).toLocaleLowerCase('de');
  return Object.keys(fields).find((k) => normalizeFieldKey(k).toLocaleLowerCase('de') === folded);
}
