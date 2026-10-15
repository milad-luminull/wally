// @ts-check
import { base } from '@wally/config/eslint';

/** The model library and its providers (ADR-0013). */
const MODEL_LIBRARY = ['ai', 'ai/*', '@ai-sdk/*'];

export default [
  ...base,
  {
    ignores: ['prisma/generated/**'],
  },
  {
    // The library is imported only inside the boundary directory, so leaving it means
    // rewriting that directory and nothing else.
    files: ['src/**/*.ts', 'test/**/*.ts'],
    ignores: ['src/lib/assistant/model/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: MODEL_LIBRARY,
              message:
                'The model library is imported only under src/lib/assistant/model/ (ADR-0013).',
            },
          ],
        },
      ],
    },
  },
];
