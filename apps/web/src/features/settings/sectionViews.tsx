import type { ComponentType } from 'react';
import type { SettingsSectionId } from './sections';
import { SettingsSection } from './SettingsSection';

const placeholder = (id: SettingsSectionId) => () => (
  <SettingsSection id={id}>{null}</SettingsSection>
);

/** Each section's page. */
export const SECTION_VIEWS: Record<SettingsSectionId, ComponentType> = {
  appearance: placeholder('appearance'),
  language: placeholder('language'),
  wallybot: placeholder('wallybot'),
  connections: placeholder('connections'),
  account: placeholder('account'),
};
