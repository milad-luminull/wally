import { z } from 'zod';

/**
 * Parses a comma-separated query string param (e.g. "?priority=HOCH,MITTEL") into an
 * array validated against the given enum. Empty/missing values become undefined so
 * "no filter applied" and "filtered to nothing" stay distinguishable downstream.
 */
export function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    (val) => {
      if (typeof val !== 'string' || val.trim().length === 0) return undefined;
      return val
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    },
    z.array(z.enum(values)).optional(),
  );
}

/** Coerces the common "true"/"false" query-string boolean shape. */
export const booleanQueryParam = z.preprocess((val) => {
  if (typeof val !== 'string') return undefined;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return undefined;
}, z.boolean().optional());
