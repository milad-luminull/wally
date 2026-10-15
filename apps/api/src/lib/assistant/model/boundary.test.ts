import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Runs ESLint on one virtual file; the path decides whether the boundary rule applies. */
function lint(filePath: string, source: string) {
  const run = spawnSync('pnpm', ['exec', 'eslint', '--stdin', '--stdin-filename', filePath], {
    cwd: new URL('../../../../', import.meta.url),
    input: source,
    encoding: 'utf8',
  });
  return { status: run.status, output: run.stdout + run.stderr };
}

describe('the model library boundary (ADR-0013)', () => {
  const source = "import { generateText } from 'ai';\nexport const x = generateText;\n";

  it('rejects an import of the library outside src/lib/assistant/model/', () => {
    const result = lint('src/lib/assistant/run.ts', source);
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-imports');
  });

  it('rejects a provider import outside the boundary too', () => {
    const result = lint(
      'src/routes/boards.ts',
      "import { createGoogleVertex } from '@ai-sdk/google-vertex';\nexport const y = createGoogleVertex;\n",
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-imports');
  });

  it('allows the same import inside the boundary', () => {
    const result = lint('src/lib/assistant/model/anything.ts', source);
    expect(result.status, result.output).toBe(0);
  });
}, 60000);
