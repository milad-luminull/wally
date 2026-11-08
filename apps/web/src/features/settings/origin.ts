/**
 * Where Settings was opened from, carried in router location state so Back can return there
 * (the settings design, "Back"). State is lost on a reload or a typed URL, and anything in it
 * is untrusted, so reading it falls back to the board home.
 */
export interface SettingsLinkState {
  from: string;
  /** Set when a narrow-screen section was pushed from the list, so going back pops it. */
  fromList?: boolean;
}

const FALLBACK = '/boards';

export function settingsLinkState(location: {
  pathname: string;
  search: string;
  hash: string;
}): SettingsLinkState {
  return { from: location.pathname + location.search + location.hash };
}

export function readSettingsOrigin(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('from' in state)) return FALLBACK;
  const { from } = state;
  if (typeof from !== 'string') return FALLBACK;
  // Same-origin paths only, and never Settings itself, so Back can neither leave the site
  // nor loop.
  if (!from.startsWith('/') || from.startsWith('//')) return FALLBACK;
  if (from === '/settings' || from.startsWith('/settings/') || from.startsWith('/settings?'))
    return FALLBACK;
  return from;
}
