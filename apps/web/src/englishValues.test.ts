import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/**
 * Keeps the old spellings of the persisted values out of the code (ADR-0014, ADR-0024). The
 * values were renamed in one release with a data reset, so nothing reads or writes `HOCH`,
 * `DIESE_WOCHE`, `WEISS`, `wand` or an old `--note-*` fill any more, and a word swap that missed one
 * would only show up as a 400, an unstyled note or a dropped filter. This scan finds it first.
 *
 * A text scan rather than a lint rule, for the same reason brandGuards.test.ts is one: apps/web's
 * eslint config carries only react-hooks and react-refresh, and a custom rule would mean a new
 * dependency. Docs are outside the scan: historical plans, specs and ADRs keep their values.
 */

/** vitest runs with cwd at the package root (see vitest.config.ts). */
const REPO = join(process.cwd(), '..', '..');

/**
 * What is scanned, repo-relative: a directory (recursively) or a single file. A directory
 * contributes only files with a scanned extension; a single file is read whatever its name.
 * Every entry must exist and yield at least one file, so a moved root fails loudly instead of
 * letting the scan pass on nothing.
 */
const SCANNED = [
  'apps/web/src',
  'apps/web/e2e',
  'apps/web/index.html',
  'apps/web/public',
  'apps/api/src',
  'apps/api/test',
  'packages/shared/src',
  'scripts',
  'infra',
  '.github',
  // The SQL migrations, whose check constraints spell every persisted value.
  'apps/api/drizzle',
];

/** Root files matched by name, so a new compose file is scanned without a list change. */
const ROOT_FILE_PATTERNS: readonly RegExp[] = [/^docker-compose.*\.ya?ml$/];

/** Text formats that can carry a stored value. Markdown is docs, outside the scan. */
const EXTENSIONS = /\.(ts|tsx|mjs|cjs|css|html|svg|json|ya?ml)$/;

/** Dependencies, build output and lockfiles: generated, not written by hand. */
const SKIPPED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.turbo',
  'test-results',
  'playwright-report',
]);
const LOCKFILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']);

/** Case-sensitive: `Hoch` and `Minze` are German UI labels, not stored values. */
const OLD_SPELLINGS: readonly RegExp[] = [
  /\b(HOCH|MITTEL|NIEDRIG|HEUTE|DIESE_WOCHE|SPAETER|WEISS|EIS|SAND|MINZE|HIMMEL|NEBEL|BUTTER|LEHM|MALVE|FLIEDER|SEEGRUEN|SALBEI|OLIV)\b/,
  /['"]wand['"]/,
  /view=wand/,
  /--note-(weiss|eis|sand|minze|himmel|nebel|butter|lehm|malve|flieder|seegruen|salbei|oliv)\b/,
  /['"](weiss|eis|sand|minze|himmel|nebel|butter|lehm|malve|flieder|seegruen|salbei|oliv)['"]/,
];

/** Files that may name an old spelling anywhere, repo-relative, with the reason. */
const ALLOWED_FILES = new Map([
  ['apps/web/src/englishValues.test.ts', 'this file names the patterns'],
  ['apps/web/src/englishIdentifiers.test.ts', 'it lists the German words it bans from names'],
]);

/**
 * Tests that must spell an old value to show it is refused. Each spells them in ONE constant,
 * `const OLD = { … } as const;`, and nowhere else, so the sweep cannot have missed a line.
 */
const REFUSAL_TESTS = [
  'apps/api/src/lib/sharedValues.test.ts',
  'apps/api/src/lib/assistant/model/suggest.test.ts',
  'apps/api/src/lib/assistant/model/tidy.test.ts',
  'apps/api/test/notes.test.ts',
  'apps/api/test/me.test.ts',
  'apps/api/test/mcp.test.ts',
  'apps/web/src/features/board/hooks/useBoardViewState.test.tsx',
];

function files(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    if (statSync(child).isDirectory()) return SKIPPED_DIRECTORIES.has(entry) ? [] : files(child);
    return EXTENSIONS.test(entry) && !LOCKFILES.has(entry) ? [child] : [];
  });
}

/** The files of one scanned entry. Throws when the entry is missing or yields nothing. */
function scannedFiles(rel: string): string[] {
  const path = join(REPO, rel);
  if (!existsSync(path)) throw new Error(`scanned path ${rel} does not exist`);
  const found = files(path);
  if (found.length === 0) throw new Error(`scanned path ${rel} holds no scanned file`);
  return found;
}

/** Every scanned file, absolute, each once. */
function allScannedFiles(): string[] {
  const rootFiles = readdirSync(REPO).filter((entry) =>
    ROOT_FILE_PATTERNS.some((pattern) => pattern.test(entry)),
  );
  for (const pattern of ROOT_FILE_PATTERNS) {
    if (!rootFiles.some((entry) => pattern.test(entry)))
      throw new Error(`no root file matches ${pattern}`);
  }
  return [...new Set([...SCANNED, ...rootFiles].flatMap(scannedFiles))];
}

const repoRelative = (file: string) => relative(REPO, file).split(sep).join('/');

/** 1-based line numbers holding an old spelling, with the match. */
function hits(text: string): Array<{ line: number; match: string }> {
  return text.split('\n').flatMap((content, i) =>
    OLD_SPELLINGS.flatMap((pattern) => {
      const match = pattern.exec(content);
      return match ? [{ line: i + 1, match: match[0] }] : [];
    }),
  );
}

/** The 1-based line range of the file's one `const OLD = … as const;` block, or null. */
function oldConstant(text: string): { first: number; last: number } | null {
  const lines = text.split('\n');
  const starts = lines.flatMap((content, i) => (/^const OLD = /.test(content) ? [i] : []));
  if (starts.length !== 1) return null;
  const first = starts[0]!;
  const end = lines.findIndex((content, i) => i >= first && /\bas const;\s*$/.test(content));
  return end === -1 ? null : { first: first + 1, last: end + 1 };
}

describe('the persisted values are English', () => {
  it('names no old spelling outside the allow-list', () => {
    const offences = allScannedFiles()
      .map((file) => [repoRelative(file), file] as const)
      .filter(([rel]) => !ALLOWED_FILES.has(rel) && !REFUSAL_TESTS.includes(rel))
      .flatMap(([rel, file]) =>
        hits(readFileSync(file, 'utf8')).map(({ line, match }) => `${rel}:${line}  ${match}`),
      );
    expect(offences).toEqual([]);
  });

  it.each(REFUSAL_TESTS)('%s spells the old values only in its OLD constant', (rel) => {
    const text = readFileSync(join(REPO, rel), 'utf8');
    const block = oldConstant(text);
    expect(block, 'exactly one `const OLD = { … } as const;`').not.toBeNull();
    const found = hits(text);
    // The constant must still hold an old spelling, or the file no longer belongs on this list.
    expect(found.length).toBeGreaterThan(0);
    const outside = found
      .filter(({ line }) => line < block!.first || line > block!.last)
      .map(({ line, match }) => `${rel}:${line}  ${match}`);
    expect(outside).toEqual([]);
  });

  it('allow-lists only files that exist', () => {
    for (const rel of [...ALLOWED_FILES.keys(), ...REFUSAL_TESTS]) {
      expect(existsSync(join(REPO, rel)), rel).toBe(true);
    }
  });
});
