import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Stops the next feature quietly reintroducing hardcoded German.
 *
 * A test rather than a lint rule because apps/web's eslint config carries only react-hooks
 * and react-refresh — `react/jsx-no-literals` would mean a new dependency, and SETUP.md says
 * to ask first. This needs none.
 *
 * Two nets, because either alone leaks:
 *   - German-specific characters. Catches most prose, but nothing in "Mitglieder" or "Rolle".
 *   - A literal string in an aria-label, placeholder or title. Language-agnostic, and these
 *     are exactly the attributes whose copy is invisible on screen, so a missed translation
 *     there survives even a careful manual pass.
 *   - A bare word between JSX tags. Also language-agnostic; this is what caught "Mitglieder",
 *     which has no German-specific character in it at all.
 */
/** vitest runs with cwd at the package root (see vitest.config.ts). */
const SRC = join(process.cwd(), 'src');

/** Files that legitimately contain German outside the catalogues. */
const ALLOWLIST = new Set([
  // Endonyms — a language picker names each language in itself, so these are the same in
  // every locale and must never be translated.
  'features/board/AccountMenu.tsx',
  // The product name is a proper noun.
  'routes/AuthLayout.tsx',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return entry === 'i18n' || entry === 'test' ? [] : sourceFiles(full);
    }
    if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) return [];
    return [full];
  });
}

/** Strips comments, which are allowed to stay German and often explain the copy. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('no hardcoded German copy outside the catalogues', () => {
  it('finds none', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file);
      if (ALLOWLIST.has(rel)) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      code.split('\n').forEach((line, index) => {
        const german = /[äöüßÄÖÜ„]/.test(line);
        const literalAttribute = /\b(aria-label|placeholder|title)="[^"]+"/.test(line);
        // Text between tags with no interpolation in it — i.e. copy, not a rendered value.
        const literalJsxText = /<[^<>]*>[^<>{}]*[A-Za-z]{2,}[^<>{}]*<\//.test(line);
        if (german || literalAttribute || literalJsxText) {
          offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(offenders).toEqual([]);
  });
});
