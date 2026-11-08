import { Cable, Languages, ListChecks, Palette, UserRound, type LucideIcon } from 'lucide-react';

export type SettingsSectionId = 'appearance' | 'language' | 'wallybot' | 'connections' | 'account';

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  icon: LucideIcon;
  labelKey: `settings.sections.${SettingsSectionId}.label`;
  descriptionKey: `settings.sections.${SettingsSectionId}.description`;
}

function section(id: SettingsSectionId, icon: LucideIcon): SettingsSectionMeta {
  return {
    id,
    icon,
    labelKey: `settings.sections.${id}.label`,
    descriptionKey: `settings.sections.${id}.description`,
  };
}

/** The settings menu, in order. */
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  section('appearance', Palette),
  section('language', Languages),
  section('wallybot', ListChecks),
  section('connections', Cable),
  section('account', UserRound),
];

export function isSettingsSectionId(value: string | undefined): value is SettingsSectionId {
  return SETTINGS_SECTIONS.some((s) => s.id === value);
}
