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
      HIGH: t('enums.priority.HIGH'),
      MEDIUM: t('enums.priority.MEDIUM'),
      LOW: t('enums.priority.LOW'),
    } satisfies Record<NotePriority, string>,
    horizon: {
      TODAY: t('enums.horizon.TODAY'),
      THIS_WEEK: t('enums.horizon.THIS_WEEK'),
      LATER: t('enums.horizon.LATER'),
    } satisfies Record<NoteHorizon, string>,
    colour: {
      CHALK: t('enums.colour.CHALK'),
      ICE: t('enums.colour.ICE'),
      STONE: t('enums.colour.STONE'),
      MINT: t('enums.colour.MINT'),
      SKY: t('enums.colour.SKY'),
      MIST: t('enums.colour.MIST'),
      OAT: t('enums.colour.OAT'),
      CLAY: t('enums.colour.CLAY'),
      ROSE: t('enums.colour.ROSE'),
      MALLOW: t('enums.colour.MALLOW'),
      HEATHER: t('enums.colour.HEATHER'),
      SEA_GREEN: t('enums.colour.SEA_GREEN'),
      SAGE: t('enums.colour.SAGE'),
      OLIVE: t('enums.colour.OLIVE'),
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
