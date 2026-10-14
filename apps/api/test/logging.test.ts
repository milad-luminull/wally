import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { requestLogSerializers } from '../src/app.js';

/**
 * GDPR GAP-05: the API's request log must not record who called it. Fastify's default request
 * serializer writes the client's address, port and host; the app replaces it with method and
 * path only. These checks build a server with the app's serializers and read what it logs.
 */
async function logsFor(request: {
  url: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}) {
  const lines: string[] = [];
  const app = Fastify({
    logger: { serializers: requestLogSerializers, stream: { write: (line) => lines.push(line) } },
  });
  app.get('/*', async () => ({ ok: true }));
  await app.inject({ method: 'GET', ...request });
  await app.close();
  return lines.join('');
}

describe('request log', () => {
  it('records no client address, port or headers', async () => {
    const log = await logsFor({
      url: '/whiteboards/b1',
      remoteAddress: '203.0.113.7',
      headers: {
        authorization: 'Bearer secret-token',
        cookie: 'session=abc',
        'user-agent': 'UA/1',
      },
    });
    expect(log).toContain('"req":{"method":"GET","url":"/whiteboards/b1"}');
    for (const leak of [
      '203.0.113.7',
      'remoteAddress',
      'remotePort',
      'Bearer',
      'secret-token',
      'session=abc',
      'UA/1',
    ])
      expect(log).not.toContain(leak);
  });

  it('drops the query string and redacts share-link tokens', async () => {
    const log = await logsFor({ url: '/share-links/tok-123/redeem?email=max@example.com' });
    expect(log).toContain('"url":"/share-links/[redacted]/redeem"');
    expect(log).not.toContain('tok-123');
    expect(log).not.toContain('max@example.com');
  });
});
