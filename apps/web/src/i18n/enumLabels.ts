import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  EffectiveRole,
  NoteColour,
  NoteHorizon,
  NotePriority,
  NoteVisibility,
  WhiteboardRole,
} from '@wally/shared';

/** The app's translate function, for the pure helpers that take one as a parameter. */
export type T = TFunction<'translation'>;

/**
 * Display labels for the persisted enum values, replacing the *_LABELS maps that used to live
 * in @wally/shared (they had no API consumer — only the web ever rendered them).
 *
 * Written out per member rather than derived from the *Values arrays because
 * `Object.fromEntries` produces an index signature, which `noUncheckedIndexedAccess` then
 * widens to `string | undefined` at every call site. `satisfies` keeps each map exhaustive, so
 * adding a colour to @wally/shared and forgetting it here is a compile error — which is what
 * the old Record<NoteColour, string> annotation bought, preserved.
 */
export function enumLabels(t: T) {
  return {
    priority: {
      HOCH: t('enums.priority.HOCH'),
      MITTEL: t('enums.priority.MITTEL'),
      NIEDRIG: t('enums.priority.NIEDRIG'),
    } satisfies Record<NotePriority, string>,
    horizon: {
      HEUTE: t('enums.horizon.HEUTE'),
      DIESE_WOCHE: t('enums.horizon.DIESE_WOCHE'),
      SPAETER: t('enums.horizon.SPAETER'),
    } satisfies Record<NoteHorizon, string>,
    colour: {
      WEISS: t('enums.colour.WEISS'),
      EIS: t('enums.colour.EIS'),
      SAND: t('enums.colour.SAND'),
      MINZE: t('enums.colour.MINZE'),
      HIMMEL: t('enums.colour.HIMMEL'),
      NEBEL: t('enums.colour.NEBEL'),
      BUTTER: t('enums.colour.BUTTER'),
      LEHM: t('enums.colour.LEHM'),
      ROSE: t('enums.colour.ROSE'),
      MALVE: t('enums.colour.MALVE'),
      FLIEDER: t('enums.colour.FLIEDER'),
      SEEGRUEN: t('enums.colour.SEEGRUEN'),
      SALBEI: t('enums.colour.SALBEI'),
      OLIV: t('enums.colour.OLIV'),
    } satisfies Record<NoteColour, string>,
    whiteboardRole: {
      VIEW: t('enums.whiteboardRole.VIEW'),
      EDIT: t('enums.whiteboardRole.EDIT'),
    } satisfies Record<WhiteboardRole, string>,
    effectiveRole: {
      OWNER: t('enums.effectiveRole.OWNER'),
      EDIT: t('enums.effectiveRole.EDIT'),
      VIEW: t('enums.effectiveRole.VIEW'),
    } satisfies Record<EffectiveRole, string>,
    visibility: {
      PRIVATE: t('enums.visibility.PRIVATE'),
      SHARED: t('enums.visibility.SHARED'),
    } satisfies Record<NoteVisibility, string>,
  };
}

export type EnumLabels = ReturnType<typeof enumLabels>;

/** Component-side companion. Rebuilds on `languageChanged`, since react-i18next hands back a
 * new `t` reference then. */
export function useEnumLabels(): EnumLabels {
  const { t } = useTranslation();
  return useMemo(() => enumLabels(t), [t]);
}
