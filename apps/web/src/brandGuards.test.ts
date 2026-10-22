import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Enforces the two brand rules that are easiest to break by accident and hardest to spot in
 * review. See docs/BRAND.md for the reasoning; this file is only the tripwire.
 *
 * A test rather than a lint rule, for the same reason noHardcodedCopy.test.ts is one:
 * apps/web's eslint config carries only react-hooks and react-refresh, and a custom rule
 * would mean a new dependency.
 */

/** vitest runs with cwd at the package root (see vitest.config.ts). */
const SRC = join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

const FILES = sourceFiles(SRC).map((f) => [relative(SRC, f), readFileSync(f, 'utf8')] as const);

/**
 * "No sparkle, wand, robot or brain icon anywhere in the product." The AI has no iconography
 * because it has no presence — it fills in what you would have typed and gets out of the way.
 *
 * The names below are lucide import specifiers, matched exactly: a filename, an identifier
 * or a catalogue value that merely resembles one is not an icon import and never matches.
 */
const BANNED_ICONS = [
  'Sparkle',
  'Sparkles',
  'Wand',
  'Wand2',
  'WandSparkles',
  'Bot',
  'BotMessageSquare',
  'Brain',
  'BrainCircuit',
  'BrainCog',
  'Stars',
  'Zap',
];

describe('AI has no iconography', () => {
  it('imports no sparkle, wand, robot or brain icon from lucide-react', () => {
    const offences: string[] = [];
    for (const [file, text] of FILES) {
      for (const match of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'lucide-react'/g)) {
        for (const raw of (match[1] ?? '').split(',')) {
          const name = raw
            .trim()
            .split(/\s+as\s+/)[0]
            ?.trim();
          if (name && BANNED_ICONS.includes(name)) offences.push(`${file}: ${name}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });
});

/**
 * "Status colours are text only. No badges, not tinted rows. They appear in the due-date line
 * and nowhere else." A `bg-` or `border-` carrying a status hue is the exact thing that rule
 * forbids, and it is the natural thing to reach for when adding a banner or a chip.
 */
// User-approved exception: Connected apps uses small green/red connection lights.
// This does not permit tinted cards, rows or banners elsewhere.
const CONNECTION_LIGHTS = new Set(['bg-status-success', 'bg-status-danger']);

describe('status colour stays text', () => {
  it('never fills a surface with a status token', () => {
    const offences: string[] = [];
    for (const [file, text] of FILES) {
      for (const match of text.matchAll(
        /\b(bg|border|ring|fill|from|to|via)-\[?(?:color:)?(?:var\()?--?status-[\w-]+/g,
      )) {
        offences.push(`${file}: ${match[0]}`);
      }
      for (const match of text.matchAll(/\b(bg|border|ring|fill)-status-[\w-]+/g)) {
        if (file === 'routes/ConnectionsPage.tsx' && CONNECTION_LIGHTS.has(match[0])) continue;
        offences.push(`${file}: ${match[0]}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
