import type { ParseKeys } from 'i18next';

/**
 * A catalogue key, typed against the German catalogue via CustomTypeOptions.
 *
 * Exists so a user-visible message can be held in React state as a KEY rather than as
 * resolved copy. Storing the resolved string is the subtle bug this prevents: a validation
 * message or auth error already on screen would keep its old language after a switch, because
 * nothing re-runs the code that produced it — and a suite that renders in German by default
 * would never catch it.
 */
export type MessageKey = ParseKeys<'translation'>;
