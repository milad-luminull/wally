import { describe, expect, it } from 'vitest';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';
import { SEVERITY, loggerOptions, safeErrorFields } from '../src/lib/logging/index.js';

function streamInto(lines: string[]) {
  return { write: (line: string) => void lines.push(line) };
}

/**
 * GDPR GAP-05: the API's request log must not record who called it. Fastify's default request
 * serializer writes the client's address, port and host; the app replaces it with method and
 * path only. These checks build a server with the app's logger options and read what it logs.
 */
async function logsFor(request: {
  url: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}) {
  const lines: string[] = [];
  const app = Fastify({ logger: { ...loggerOptions(), stream: streamInto(lines) } });
  app.get('/*', async (req) => {
    req.log.info({ req }, 'seen');
    return { ok: true };
  });
  await app.inject({ method: 'GET', ...request });
  await app.close();
  return lines.join('');
}

/** One line, as the app's logger options write it. */
async function logOne(write: (log: FastifyBaseLogger) => void): Promise<string> {
  const lines: string[] = [];
  const app = Fastify({ logger: { ...loggerOptions(), stream: streamInto(lines) } });
  write(app.log);
  await app.close();
  return lines[0]!;
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

describe('Cloud Logging fields', () => {
  it('writes severity beside the numeric level, message and an ISO time', async () => {
    const line = JSON.parse(await logOne((log) => log.warn({ type: 'x' }, 'careful')));
    expect(line).toMatchObject({ severity: 'WARNING', level: 40, message: 'careful' });
    expect(line.msg).toBeUndefined();
    expect(new Date(line.time).toISOString()).toBe(line.time);
  });

  it.each([
    ['trace', 'DEBUG'],
    ['debug', 'DEBUG'],
    ['info', 'INFO'],
    ['warn', 'WARNING'],
    ['error', 'ERROR'],
    ['fatal', 'CRITICAL'],
  ] as const)('maps %s to %s', (label, severity) => expect(SEVERITY[label]).toBe(severity));
});

describe('safe error fields', () => {
  it('keeps name, message, stack and code of an ordinary error, nothing else', () => {
    const error = Object.assign(new Error('boom'), { code: 'E_X', secret: 'leak' });
    expect(safeErrorFields(error)).toEqual({
      type: 'Error',
      message: 'boom',
      stack: error.stack,
      code: 'E_X',
    });
  });

  it('drops the message, query and params of a failed Drizzle query', () => {
    const cause = Object.assign(new Error('invalid input syntax for type uuid: "my note"'), {
      code: '22P02',
    });
    const error = new DrizzleQueryError('select * from notes where id = $1', ['my note'], cause);
    const fields = safeErrorFields(error);
    expect(JSON.stringify(fields)).not.toMatch(/my note|select|params/);
    expect(fields).toMatchObject({ type: 'DrizzleQueryError', code: '22P02' });
    expect(fields.stack?.split('\n')[0]).toBe('DrizzleQueryError');
    expect(fields.stack?.split('\n')[1]).toMatch(/^ {4}at /);
  });

  it('drops the message of a Postgres error', () => {
    const PostgresError = postgres.PostgresError as unknown as new (fields: object) => Error;
    const error = new PostgresError({ message: 'value "secret" too long', code: '22001' });
    expect(safeErrorFields(error)).toMatchObject({ type: 'PostgresError', code: '22001' });
    expect(JSON.stringify(safeErrorFields(error))).not.toContain('secret');
  });

  it("writes the safe fields as the line's err", async () => {
    const error = Object.assign(new Error('boom'), { secret: 'leak' });
    const line = JSON.parse(await logOne((log) => log.error({ err: error }, 'failed')));
    expect(line.err).toEqual({ type: 'Error', message: 'boom', stack: error.stack });
  });

  it.each([
    ['a string', 'oops'],
    ['null', null],
    ['an object', { reason: 'x' }],
  ])('survives %s thrown', (_label, thrown) => expect(() => safeErrorFields(thrown)).not.toThrow());
});
