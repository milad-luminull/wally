import { describe, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';

type Catalogue = Record<string, unknown>;

/** Dotted key -> string value, so two catalogues can be compared as flat maps. */
function flatten(node: Catalogue, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else if (value && typeof value === 'object') {
      for (const [nested, nestedValue] of flatten(value as Catalogue, path)) {
        out.set(nested, nestedValue);
      }
    }
  }
  return out;
}

const german = flatten(de as unknown as Catalogue);
const english = flatten(en as unknown as Catalogue);

/** `{{name}}` and `{{date, datetime(...)}}` both yield just the variable name. */
function placeholders(value: string): string[] {
  return [...value.matchAll(/\{\{\s*([^},]+?)\s*(?:,[^}]*)?\}\}/g)]
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
    .sort();
}

function tags(value: string): string[] {
  return [...value.matchAll(/<(\/?[a-zA-Z][\w-]*)\s*\/?>/g)]
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
    .sort();
}

describe('message catalogues', () => {
  it('cover exactly the same keys', () => {
    const missingFromEnglish = [...german.keys()].filter((key) => !english.has(key));
    const missingFromGerman = [...english.keys()].filter((key) => !german.has(key));

    expect({ missingFromEnglish, missingFromGerman }).toEqual({
      missingFromEnglish: [],
      missingFromGerman: [],
    });
  });

  // An empty string is the shape a half-finished translation takes, and it renders as an
  // invisible label rather than as an obvious hole.
  it('have no empty values', () => {
    const empty = [...german, ...english]
      .filter(([, value]) => value.trim() === '')
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  // Catches a translation that silently dropped {{count}} or {{email}}.
  it('interpolate the same variables in both languages', () => {
    const mismatched = [...german]
      .filter(([key, value]) => {
        const other = english.get(key);
        return other !== undefined && placeholders(value).join() !== placeholders(other).join();
      })
      .map(([key]) => key);

    expect(mismatched).toEqual([]);
  });

  // i18next falls back silently when one half of a plural pair is missing, which shows up as
  // "1 Notizen" rather than as an error.
  it('define both plural forms wherever either is defined', () => {
    const incomplete: string[] = [];
    for (const [label, catalogue] of [
      ['de', german],
      ['en', english],
    ] as const) {
      for (const key of catalogue.keys()) {
        const other = key.endsWith('_one')
          ? `${key.slice(0, -4)}_other`
          : key.endsWith('_other')
            ? `${key.slice(0, -6)}_one`
            : null;
        if (other && !catalogue.has(other)) incomplete.push(`${label}:${key}`);
      }
    }
    expect(incomplete).toEqual([]);
  });

  // A <Trans> value whose markup is missing renders the whole sentence as nothing.
  it('carry the same inline markup in both languages', () => {
    const mismatched = [...german]
      .filter(([key, value]) => {
        const other = english.get(key);
        return other !== undefined && tags(value).join() !== tags(other).join();
      })
      .map(([key]) => key);

    expect(mismatched).toEqual([]);
  });
});
