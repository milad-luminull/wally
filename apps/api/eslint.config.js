// @ts-check
import { base } from '@wally/config/eslint';

export default [
  ...base,
  {
    ignores: ['prisma/generated/**'],
  },
  {
    // The base config forbids the model library everywhere (ADR-0013). This directory is the
    // one place it may be imported, so leaving the library means rewriting it and nothing else.
    files: ['src/lib/assistant/model/**'],
    rules: {
      'no-restricted-imports': 'off',
      'no-restricted-syntax': 'off',
    },
  },
];
