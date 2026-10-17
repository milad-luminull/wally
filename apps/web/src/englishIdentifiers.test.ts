import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import ts from 'typescript';

/**
 * Keeps German out of the code. ADR-0014: no German identifier, file name, test id or comment
 * anywhere in `apps/web/src`, `apps/api/src` or `packages/shared/src`; the catalogue VALUES
 * (`i18n/de.ts`) and the German capture-parser word list are the only German in the tree.
 *
 * A test rather than a lint rule, for the same reason brandGuards.test.ts is one: apps/web's
 * eslint config carries only react-hooks and react-refresh, and a custom rule would mean a new
 * dependency. `typescript` is already a devDependency, so the tokens are read from the syntax
 * tree: identifiers, comments and string literals are told apart, and JSX text and regular
 * expressions are never mistaken for code.
 *
 * What it does NOT check is the content of ordinary strings: the capture parser's German input
 * cases (`'Müller anrufen Freitag'`) and the German smoke test stay German on purpose, and the
 * catalogue-driven assertions follow the catalogues.
 */

/** vitest runs with cwd at the package root (see vitest.config.ts). */
const WEB_SRC = join(process.cwd(), 'src');
const ROOTS = [
  WEB_SRC,
  join(process.cwd(), '..', 'api', 'src'),
  join(process.cwd(), '..', '..', 'packages', 'shared', 'src'),
];

/** Files that carry German by design, relative to `apps/web/src`, with the reason. */
const GERMAN_BY_DESIGN = new Set([
  // The German catalogue: its values are the German half of a bilingual product.
  `i18n${sep}de.ts`,
  // The German input lexicon (`heute`, `morgen`, `dringend`): it reads what a German user types.
  `lib${sep}capture${sep}parseCapture.ts`,
  // This file names the banned words.
  'englishIdentifiers.test.ts',
]);

/** The German words a name may not be built from, compared whole and case-insensitively. */
const BANNED_WORDS = new Set(['wand', 'frei', 'liste', 'horizont', 'alle']);

/**
 * Lowercase `wand` is the persisted board-view value (`boardViewValues`), the string 'wand' in
 * Firestore documents, URLs (`?view=wand`) and profiles. It cannot change until the expand
 * release (ADR-0014 step 4: legacy map, read normalisation, migration), so these literals are
 * allowed until then. When that release lands, delete this list and the guard bans them too.
 */
const ALLOWED_WAND_LITERALS: ReadonlyArray<(text: string) => boolean> = [
  // The persisted value itself, as a literal: `'wand'`.
  (text) => text === 'wand',
  // The same value inside a URL query, as the web app reads it (`?view=wand`).
  (text) => /[?&]view=wand\b/.test(text),
  // The command palette's search keywords for the "ask the board" entry. They sit beside the
  // English words so a German user typing `wand` or `fragen` still finds it (cmdk matches on
  // this value, not on the label); the same job as a catalogue value, so it waits with them.
  (text) => text === 'ask question wand fragen',
  // English prose about the banned magic-wand icon (brandGuards.test.ts's test title).
  (text) => text === 'imports no sparkle, wand, robot or brain icon from lucide-react',
];

/** lucide icon specifiers the brand guard bans by name; they are not German. */
const LUCIDE_ICON_NAMES = new Set(['Wand', 'Wand2', 'WandSparkles']);

/** German in a comment or in a string (test titles, import paths, test ids), not just a name. */
const COMMENT_PATTERN = /\b(?:Wand|Frei|Liste|Horizont|ALLE)\b|\bWand[A-Z0-9]|\bwand-/;
const STRING_PATTERN = /Wand[A-Z0-9]|\bwand-|\bFrei[ -]mode\b|\bALLE\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

/** `WandView` -> ['Wand', 'View'], `ALLE` -> ['ALLE'], `data-testid` -> ['data', 'testid']. */
function words(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) ?? []);
}

function bannedIn(name: string): string[] {
  return words(name).filter((word) => BANNED_WORDS.has(word.toLowerCase()));
}

interface Offence {
  where: string;
  what: string;
}

function scan(file: string, label: string): Offence[] {
  const text = readFileSync(file, 'utf8');
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const offences: Offence[] = [];
  const seenComments = new Set<number>();
  const at = (pos: number) => {
    const { line } = source.getLineAndCharacterOfPosition(pos);
    return `${label}:${line + 1}`;
  };

  const checkComments = (pos: number) => {
    for (const range of ts.getLeadingCommentRanges(text, pos) ?? []) {
      if (seenComments.has(range.pos)) continue;
      seenComments.add(range.pos);
      const comment = text.slice(range.pos, range.end);
      const match = COMMENT_PATTERN.exec(comment);
      if (match) offences.push({ where: at(range.pos), what: `comment: ${match[0]}` });
    }
  };

  const checkString = (node: ts.Node, value: string) => {
    if (LUCIDE_ICON_NAMES.has(value)) return;
    const match = STRING_PATTERN.exec(value);
    if (match) offences.push({ where: at(node.getStart(source)), what: `string: ${match[0]}` });
    if (/\bwand\b/.test(value) && !ALLOWED_WAND_LITERALS.some((allowed) => allowed(value))) {
      offences.push({ where: at(node.getStart(source)), what: `string: wand in "${value}"` });
    }
  };

  const visit = (node: ts.Node) => {
    checkComments(node.pos);
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      for (const word of bannedIn(node.text)) {
        offences.push({
          where: at(node.getStart(source)),
          what: `identifier: ${node.text} (${word})`,
        });
      }
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      checkString(node, node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      checkString(node, node.text);
    }
    for (const child of node.getChildren(source)) visit(child);
  };
  visit(source);
  return offences;
}

function offencesIn(root: string): Offence[] {
  const offences: Offence[] = [];
  for (const file of files(root)) {
    const inWeb = root === WEB_SRC;
    const rel = relative(root, file);
    if (inWeb && GERMAN_BY_DESIGN.has(rel)) continue;
    // `apps/api/src` and `packages/shared/src` are labelled by their package for a readable report.
    const label = inWeb ? `apps/web/src/${rel}` : relative(join(process.cwd(), '..', '..'), file);
    for (const segment of rel.split(sep)) {
      for (const word of bannedIn(segment.replace(/\.[^.]+$/, ''))) {
        offences.push({ where: label, what: `path: ${segment} (${word})` });
      }
    }
    if (/\.tsx?$/.test(file)) offences.push(...scan(file, label));
  }
  return offences;
}

describe('code is English', () => {
  it.each([
    ['apps/web/src', ROOTS[0]!],
    ['apps/api/src', ROOTS[1]!],
    ['packages/shared/src', ROOTS[2]!],
  ])('has no German identifier, path, test id or comment under %s', (_name, root) => {
    expect(offencesIn(root).map((o) => `${o.where}  ${o.what}`)).toEqual([]);
  });

  it('keeps the persisted board-view value `wand` until the expand release (ADR-0014 step 4)', async () => {
    // The guard's allow-list is only honest while the value still exists; when the enum
    // moves, this fails and the allow-list above goes with it.
    const { boardViewValues } = await import('@wally/shared');
    expect(boardViewValues).toContain('wand');
  });
});
