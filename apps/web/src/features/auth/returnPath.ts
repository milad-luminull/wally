/**
 * Only the two kinds of link a signed-out visitor can legitimately arrive with are worth
 * returning to after sign-in: a share link and a board. Anything else (an external URL, a
 * protocol-relative `//host`, the login page itself) is dropped.
 */
const ALLOWED = /^\/(share|boards)\/[^/?#]/;

/** The in-app path a visitor was sent to /login from, or null (RFC BOARD_HOME §5). */
export function readReturnPath(state: unknown): string | null {
  const from = (state as { from?: unknown } | null | undefined)?.from;
  if (typeof from !== 'string' || from.startsWith('//')) return null;
  return ALLOWED.test(from) ? from : null;
}

/**
 * Where sign-in and sign-up navigate: the protected board entry, which checks the return path against
 * the board list of whoever actually signed in before following it.
 */
export function boardEntryWithReturn(from: string | null) {
  return { pathname: '/app' as const, state: { to: from } };
}
