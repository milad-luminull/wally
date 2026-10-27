import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = fileURLToPath(new URL('../../', import.meta.url));
const moduleDir = fileURLToPath(new URL('./', import.meta.url));

function* typescriptFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* typescriptFiles(path);
    else if (entry.name.endsWith('.ts')) yield path;
  }
}

/** A relative import or re-export whose path names the postgres module. */
const POSTGRES_IMPORT = /(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]*postgres[^'"]*)['"]/g;

describe('the postgres module', () => {
  it('is imported by nothing outside it until workstream 2 switches the API over', () => {
    const offenders: string[] = [];
    for (const file of typescriptFiles(source)) {
      if (file.startsWith(moduleDir)) continue;
      for (const match of readFileSync(file, 'utf8').matchAll(POSTGRES_IMPORT))
        offenders.push(`${relative(source, file)}: ${match[1]}`);
    }
    expect(offenders).toEqual([]);
  });
});
