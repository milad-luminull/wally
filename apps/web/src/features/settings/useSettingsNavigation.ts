import { useLocation, useNavigate } from 'react-router';
import { readSettingsOrigin, settingsOriginFrom, type SettingsLinkState } from './origin';
import type { SettingsSectionId } from './sections';

/**
 * Moving around Settings without losing the way out. Switching sections replaces the entry
 * and carries the origin forward, so one Back (the control or the browser's) leaves Settings.
 */
export function useSettingsNavigation() {
  const navigate = useNavigate();
  const location = useLocation();
  const origin = readSettingsOrigin(location.state);
  // An entry that carries a trusted origin sits directly above it in history (links push,
  // section switches and redirects replace), or one above the list when pushed from it.
  const hasOrigin = settingsOriginFrom(location.state) !== null;
  const fromList = Boolean((location.state as Partial<SettingsLinkState> | null)?.fromList);

  return {
    origin,
    // Popping, not pushing, so the browser's Back afterwards doesn't reopen Settings.
    goBack: () => {
      if (hasOrigin) navigate(fromList ? -2 : -1);
      else navigate(origin);
    },
    openSection: (id: SettingsSectionId, opts?: { fromList?: boolean }) =>
      navigate(`/settings/${id}`, {
        replace: !opts?.fromList,
        state: { from: origin, fromList: opts?.fromList } satisfies SettingsLinkState,
      }),
    backToList: () => {
      if (fromList) navigate(-1);
      else
        navigate('/settings', {
          replace: true,
          state: { from: origin } satisfies SettingsLinkState,
        });
    },
  };
}
