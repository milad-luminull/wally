import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { paletteValues } from '@wally/shared';
import { PALETTES, parsePalette } from './palettes';
const base = readFileSync('src/styles/globals.css', 'utf8');
const css = readFileSync('src/styles/palettes.css', 'utf8').replaceAll("'", '"');
const tokens = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)].map((m) => [m[1]!, m[2]!]),
  );
function luminance(hex: string) {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
it('includes Minimal and every reference palette with a safe fallback', () => {
  expect(Object.keys(PALETTES).sort()).toEqual([...paletteValues].sort());
  expect(parsePalette('minimal')).toBe('minimal');
  expect(parsePalette('bad')).toBe('paper');
  expect(css).not.toContain('[data-palette="minimal"]');
});
it.each(paletteValues)(
  '%s keeps body text, note metadata and status readable in both appearances',
  (palette) => {
    for (const mode of ['', '.dark']) {
      const defaults = {
        ...tokens(base.split('.dark {')[0]!),
        ...(mode ? tokens(base.split('.dark {')[1]!.split('}')[0]!) : {}),
      };
      const block = css.split(`:root[data-palette="${palette}"]${mode} {`)[1]?.split('}')[0] ?? '';
      if (palette !== 'minimal')
        expect(block, `${palette}${mode}: palette tokens must exist`).not.toBe('');
      const t = { ...defaults, ...tokens(block) };
      expect(contrast(t['fg-1']!, t.canvas!), `${palette}${mode}: body`).toBeGreaterThanOrEqual(7);
      expect(
        contrast(t['fg-3']!, t.surface!),
        `${palette}${mode}: secondary`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(t['accent-foreground']!, t.accent!),
        `${palette}${mode}: accent`,
      ).toBeGreaterThanOrEqual(4.5);
      for (const [name, fill] of Object.entries(t).filter(
        ([key]) => key.startsWith('note-') && !['note-border', 'note-selected'].includes(key),
      )) {
        for (const fg of ['fg-meta-on-note', 'status-danger', 'status-warning', 'status-success'])
          expect(
            contrast(t[fg]!, fill),
            `${palette}${mode}: ${fg} on ${name}`,
          ).toBeGreaterThanOrEqual(4.5);
      }
    }
  },
);
