// @ts-check
import { base } from '@wally/config/eslint';

export default [
  ...base,
  {
    ignores: ['prisma/generated/**'],
  },
];
