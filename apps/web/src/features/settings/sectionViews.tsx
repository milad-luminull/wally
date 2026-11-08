import type { ComponentType } from 'react';
import type { SettingsSectionId } from './sections';
import { AccountSettings } from './sections/AccountSettings';
import { AppearanceSettings } from './sections/AppearanceSettings';
import { ConnectionsSettings } from './sections/ConnectionsSettings';
import { LanguageSettings } from './sections/LanguageSettings';
import { WallybotSettings } from './sections/WallybotSettings';

/** Each section's page. */
export const SECTION_VIEWS: Record<SettingsSectionId, ComponentType> = {
  appearance: AppearanceSettings,
  language: LanguageSettings,
  wallybot: WallybotSettings,
  connections: ConnectionsSettings,
  account: AccountSettings,
};
