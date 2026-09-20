import { de } from './de';
import { en } from './en';

/**
 * One namespace. Namespaces exist to scope lazy loading, and nothing here is lazy — the
 * catalogues are bundled — so more than one would only complicate CustomTypeOptions and force
 * `useTranslation('x')` at every call site.
 */
export const defaultNS = 'translation';

export const resources = {
  de: { translation: de },
  en: { translation: en },
} as const;
