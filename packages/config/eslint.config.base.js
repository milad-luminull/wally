// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

const BOUNDARY_MESSAGE =
  'The model library is imported only under apps/api/src/lib/assistant/model/ (ADR-0013).';

/** The model library and its providers (ADR-0013), as no-restricted-imports patterns. */
export const MODEL_LIBRARY_PATTERNS = [
  { group: ['ai', 'ai/*', '@ai-sdk/*'], message: BOUNDARY_MESSAGE },
];

// `ai`, `ai/...` or `@ai-sdk/...`, and not `aiohttp` or `airtable`. esquery regexes cannot
// contain a literal slash, so it is written as \x2F.
const MODEL_LIBRARY_SOURCE = String.raw`/^(ai(\x2F|$)|@ai-sdk\x2F)/`;

/**
 * The imports no-restricted-imports does not see, as no-restricted-syntax entries:
 * `import('ai')`, the type query `typeof import('ai')` / `import('ai').X`,
 * `import x = require('ai')` and `require('ai')`.
 */
export const MODEL_LIBRARY_SYNTAX = [
  `ImportExpression[source.value=${MODEL_LIBRARY_SOURCE}]`,
  `ImportExpression[source.quasis.length=1][source.quasis.0.value.cooked=${MODEL_LIBRARY_SOURCE}]`,
  `TSImportType[source.value=${MODEL_LIBRARY_SOURCE}]`,
  `TSExternalModuleReference[expression.value=${MODEL_LIBRARY_SOURCE}]`,
  `CallExpression[callee.name='require'][arguments.0.value=${MODEL_LIBRARY_SOURCE}]`,
].map((selector) => ({ selector, message: BOUNDARY_MESSAGE }));

/**
 * Shared base config — apps extend this array and append their own env-specific rules.
 *
 * It forbids the model library everywhere. apps/api turns the two rules off for its boundary
 * directory only. A package that sets no-restricted-imports or no-restricted-syntax itself
 * replaces these options, so it must spread MODEL_LIBRARY_PATTERNS / MODEL_LIBRARY_SYNTAX in.
 */
export const base = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    ignores: ['dist/**', 'build/**', '.turbo/**', 'node_modules/**', 'coverage/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', { patterns: MODEL_LIBRARY_PATTERNS }],
      'no-restricted-syntax': ['error', ...MODEL_LIBRARY_SYNTAX],
    },
  },
);

export default base;
