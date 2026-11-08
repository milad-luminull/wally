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

/** The origin from location state, or null when there is none worth trusting. */
export function settingsOriginFrom(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('from' in state)) return null;
  const { from } = state;
  if (typeof from !== 'string' || !from.startsWith('/')) return null;
  // Parse it the way the browser will: `/\host` and `/<tab>/host` are other origins too.
  let url: URL;
  try {
    url = new URL(from, window.location.origin);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  // Never Settings itself (routes match case-insensitively), so Back cannot loop.
  const path = url.pathname.toLowerCase();
  if (path === '/settings' || path.startsWith('/settings/')) return null;
  return url.pathname + url.search + url.hash;
}

export function readSettingsOrigin(state: unknown): string {
  return settingsOriginFrom(state) ?? FALLBACK;
}
