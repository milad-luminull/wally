import 'i18next';
import type { defaultNS, resources } from './resources';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    /** German is the key authority; resources.test.ts holds English to the same key set. */
    resources: (typeof resources)['de'];
    /** Makes t() return `string`, not `string | null` — without it every t() in an
     * aria-label or className position fails under `strict`. */
    returnNull: false;
  }
}
