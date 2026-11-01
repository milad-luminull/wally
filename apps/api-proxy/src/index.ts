/**
 * The API's edge on Cloudflare (ADR-0022): every request on api.wally.luminull.com goes to the
 * Cloud Run service unchanged, and its response comes back unchanged. The proxy never retries,
 * caches, logs, authenticates or follows redirects; the API stays the only place with logic.
 */
export interface Env {
  /** The Cloud Run service URL, without a trailing slash. */
  ORIGIN: string;
}

const UPSTREAM_UNAVAILABLE = JSON.stringify({
  error: 'INTERNAL_SERVER_ERROR',
  message: 'Upstream unavailable',
  retryable: true,
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // Concatenated, not resolved with new URL(path, base): that would rewrite a path like //x.
    const forwarded = new Request(env.ORIGIN + url.pathname + url.search, request);
    try {
      // A Worker's fetch reads through its zone's cache, so no-store is set on every request
      // rather than trusting each API route to send the right Cache-Control. The response is
      // returned as is, so its body streams through instead of being buffered.
      return await fetch(forwarded, { redirect: 'manual', cache: 'no-store' });
    } catch {
      // The web app treats any 5xx as temporary. No CORS headers: the browser then reports a
      // network error, which it also treats as temporary.
      return new Response(UPSTREAM_UNAVAILABLE, {
        status: 502,
        headers: { 'content-type': 'application/json' },
      });
    }
  },
};
