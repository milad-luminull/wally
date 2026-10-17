import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const API = new URL('../../../../', import.meta.url);
const WEB = new URL('../../../../../web/', import.meta.url);
const SHARED = new URL('../../../../../../packages/shared/', import.meta.url);

/**
 * Runs ESLint on one virtual file with a package's own config (apps/api by default); the path
 * decides whether the boundary rule applies.
 */
function lint(filePath: string, source: string, cwd: URL = API) {
  const run = spawnSync('pnpm', ['exec', 'eslint', '--stdin', '--stdin-filename', filePath], {
    cwd,
    input: source,
    encoding: 'utf8',
  });
  return { status: run.status, output: run.stdout + run.stderr };
}

describe('the model library boundary (ADR-0013)', () => {
  const source = "import { generateText } from 'ai';\nexport const x = generateText;\n";
  const dynamicImport = "export async function load() {\n  return import('ai');\n}\n";
  const typeQueries =
    "export type Library = typeof import('ai');\n" +
    "export type Provider = import('@ai-sdk/google-vertex').GoogleVertexProvider;\n";

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

  it('rejects a dynamic import() of the library outside the boundary', () => {
    const result = lint('src/lib/assistant/run.ts', dynamicImport);
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-syntax');
  });

  it('rejects a type query import("…") of the library outside the boundary', () => {
    const result = lint('src/lib/assistant/run.ts', typeQueries);
    expect(result.status).toBe(1);
    // One report per type query.
    expect(result.output.match(/no-restricted-syntax/g)).toHaveLength(2);
  });

  it('allows dynamic imports and type queries inside the boundary', () => {
    const result = lint('src/lib/assistant/model/anything.ts', dynamicImport + typeQueries);
    expect(result.status, result.output).toBe(0);
  });

  it('does not match packages whose names merely start with "ai"', () => {
    const result = lint(
      'src/lib/assistant/run.ts',
      "export async function load() {\n  return import('aiohttp');\n}\n" +
        "export type Other = typeof import('airtable');\n",
    );
    expect(result.status, result.output).toBe(0);
  });

  it('rejects the library in apps/web, including @ai-sdk/react', () => {
    const result = lint(
      'src/components/AssistantPanel.tsx',
      "import { useChat } from '@ai-sdk/react';\nexport const u = useChat;\n",
      WEB,
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-imports');

    const typeOnly = lint('src/components/AssistantPanel.tsx', typeQueries, WEB);
    expect(typeOnly.status).toBe(1);
    expect(typeOnly.output).toContain('no-restricted-syntax');
  });

  it('exempts only the apps/api boundary, not the same path in apps/web', () => {
    const result = lint('src/lib/assistant/model/anything.ts', source, WEB);
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-imports');
  });

  it('rejects the library in packages/shared', () => {
    const result = lint('src/index.ts', source, SHARED);
    expect(result.status).toBe(1);
    expect(result.output).toContain('no-restricted-imports');

    const dynamic = lint('src/index.ts', dynamicImport, SHARED);
    expect(dynamic.status).toBe(1);
    expect(dynamic.output).toContain('no-restricted-syntax');
  });
}, 60000);
