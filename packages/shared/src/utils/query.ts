import { z } from 'zod';

/**
 * Parses a comma-separated query string param (e.g. "?priority=HIGH,MEDIUM") into an
 * array validated against the given enum. Already parsed arrays remain valid when the
 * application layer validates a query again. Empty/missing values become undefined so
 * "no filter applied" and "filtered to nothing" stay distinguishable downstream.
 */
export function csvEnum<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    (val) => {
      if (typeof val !== 'string') return val;
      if (val.trim().length === 0) return undefined;
      return val
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
    },
    z.array(z.enum(values)).optional(),
  );
}

/** Accepts typed booleans as well as their HTTP query-string representation. */
export const booleanQueryParam = z.preprocess((val) => {
  if (val === '') return undefined;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return val;
}, z.boolean().optional());
