/**
 * A request path as a log line may hold it: the query string dropped and share-link tokens
 * redacted, since either can grant or reveal access.
 */
export function redactPath(url: string): string {
  return url.split('?')[0]!.replace(/(\/share-links\/)[^/?]+/g, '$1[redacted]');
}

/**
 * Text with every quoted path redacted as `redactPath` does. Fastify quotes the raw request
 * URL in some of its own warnings and errors ("Reply was already sent … in "/path?query"").
 */
export function redactQuotedPaths(text: string): string {
  return text.replace(/"(\/[^"\s]*)"/g, (_match, path: string) => `"${redactPath(path)}"`);
}
