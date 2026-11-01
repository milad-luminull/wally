import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index.js';

const env = { ORIGIN: 'https://origin.example' };
const UPSTREAM_BODY =
  '{"error":"INTERNAL_SERVER_ERROR","message":"Upstream unavailable","retryable":true}';

/** Stubs the global fetch and returns the requests it received. */
function stubOrigin(answer: () => Promise<Response> = async () => new Response('ok')) {
  const seen: Request[] = [];
  const stub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return answer();
  });
  vi.stubGlobal('fetch', stub);
  return { seen, stub };
}

afterEach(() => vi.unstubAllGlobals());

describe('the API proxy', () => {
  it('forwards to ORIGIN plus the path and query, byte for byte', async () => {
    const { seen } = stubOrigin();
    await worker.fetch(new Request('https://api.example/share-links/a%2Fb?x=1&y=%20'), env);
    await worker.fetch(new Request('https://api.example//boards'), env);
    expect(seen.map((request) => request.url)).toEqual([
      'https://origin.example/share-links/a%2Fb?x=1&y=%20',
      'https://origin.example//boards',
    ]);
  });

  it('forwards the method and every header unchanged', async () => {
    const { seen } = stubOrigin();
    const headers = {
      authorization: 'Bearer token-value',
      origin: 'https://wally.luminull.com',
      'content-type': 'application/json',
      'idempotency-key': 'key-1',
      'x-expected-revision': '7',
      'mcp-protocol-version': '2025-06-18',
      'cf-connecting-ip': '203.0.113.9',
    };
    await worker.fetch(
      new Request('https://api.example/boards/b1', { method: 'PATCH', headers, body: '{}' }),
      env,
    );
    expect(seen[0]!.method).toBe('PATCH');
    for (const [name, value] of Object.entries(headers))
      expect(seen[0]!.headers.get(name)).toBe(value);
  });

  it('forwards a 256 KB POST body intact', async () => {
    const { seen } = stubOrigin();
    const body = new Uint8Array(256 * 1024).map((_, index) => index % 251);
    await worker.fetch(new Request('https://api.example/mcp', { method: 'POST', body }), env);
    expect(new Uint8Array(await seen[0]!.arrayBuffer())).toEqual(body);
  });

  it('forwards GET and HEAD without a body', async () => {
    const { seen } = stubOrigin();
    await worker.fetch(new Request('https://api.example/health'), env);
    await worker.fetch(new Request('https://api.example/health', { method: 'HEAD' }), env);
    expect(seen.map((request) => [request.method, request.body])).toEqual([
      ['GET', null],
      ['HEAD', null],
    ]);
  });

  it('never caches and never follows redirects', async () => {
    const { seen } = stubOrigin();
    await worker.fetch(new Request('https://api.example/whiteboards'), env);
    expect(seen[0]!.cache).toBe('no-store');
    expect(seen[0]!.redirect).toBe('manual');
  });

  it("returns the origin's response object itself", async () => {
    const response = new Response('streamed');
    stubOrigin(async () => response);
    expect(await worker.fetch(new Request('https://api.example/health'), env)).toBe(response);
  });

  it('passes 302 and 503 from the origin through unchanged', async () => {
    for (const status of [302, 503]) {
      const response = new Response(null, { status, headers: { location: '/elsewhere' } });
      stubOrigin(async () => response);
      const result = await worker.fetch(new Request('https://api.example/x'), env);
      expect(result).toBe(response);
      expect(result.status).toBe(status);
    }
  });

  it('answers 502 with the error body when the origin cannot be reached', async () => {
    stubOrigin(async () => {
      throw new TypeError('fetch failed');
    });
    const result = await worker.fetch(
      new Request('https://api.example/whiteboards', {
        headers: { origin: 'https://wally.luminull.com' },
      }),
      env,
    );
    expect(result.status).toBe(502);
    expect(await result.text()).toBe(UPSTREAM_BODY);
    expect([...result.headers]).toEqual([['content-type', 'application/json']]);
  });

  it('does not retry after a failure', async () => {
    const { stub } = stubOrigin(async () => {
      throw new TypeError('fetch failed');
    });
    await worker.fetch(new Request('https://api.example/whiteboards', { method: 'POST' }), env);
    expect(stub).toHaveBeenCalledTimes(1);
  });
});
