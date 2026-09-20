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
 * It looks for German-specific characters, which is a deliberately narrow net: it cannot catch
 * "Neue Notiz", and it is not trying to. It catches the overwhelming majority of real German
 * copy, and every string it does catch is unambiguously copy rather than an identifier.
 */
/** vitest runs with cwd at the package root (see vitest.config.ts). */
const SRC = join(process.cwd(), 'src');

/** Files that legitimately contain German outside the catalogues. */
const ALLOWLIST = new Set([
  // Endonyms — a language picker names each language in itself, so these are the same in
  // every locale and must never be translated.
  'features/board/AccountMenu.tsx',
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
        if (/[äöüßÄÖÜ„]/.test(line)) offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
