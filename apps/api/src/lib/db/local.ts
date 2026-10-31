/** Hosts a development or CI database runs on: the machine itself or the compose service. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', 'postgres']);

/** Whether `url` names a database on a local or compose host, never a hosted one. */
export function isLocalDatabaseUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Fixture writers (the E2E and local MCP seeds) refuse any database that is not local, and
 * any production process, before they write anything.
 */
export function assertLocalDatabase(
  env: Record<string, string | undefined>,
  purpose: string,
): void {
  if (env.NODE_ENV === 'production' || !isLocalDatabaseUrl(env.DATABASE_URL))
    throw new Error(`${purpose} requires a local database`);
}
