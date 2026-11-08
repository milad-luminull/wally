import { Navigate, useLocation, useParams } from 'react-router';
import { useBreakpoint } from '@/lib/useBreakpoint';
import { SettingsShell } from '@/features/settings/SettingsShell';
import { SECTION_VIEWS } from '@/features/settings/sectionViews';
import { isSettingsSectionId } from '@/features/settings/sections';

/** `/settings` and `/settings/:section` (the settings design, "Sections and addresses"). */
export function SettingsPage() {
  const { section } = useParams();
  const location = useLocation();
  const { isDesktop } = useBreakpoint();

  // Redirects carry the state, so Back still knows where Settings was opened from.
  if (section !== undefined && !isSettingsSectionId(section)) {
    return <Navigate to="/settings" replace state={location.state} />;
  }
  if (section === undefined && isDesktop) {
    return <Navigate to="/settings/appearance" replace state={location.state} />;
  }
  const View = section ? SECTION_VIEWS[section] : null;
  return <SettingsShell section={section}>{View && <View />}</SettingsShell>;
}
