import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyBaseLogger } from 'fastify';
import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';
import { _resetEnvCacheForTests } from '../src/env.js';
import {
  SEVERITY,
  loggerOptions,
  requestChildLogger,
  safeErrorFields,
  traceBindings,
} from '../src/lib/logging/index.js';
import { buildTestApp } from './helpers.js';

function streamInto(lines: string[]) {
  return { write: (line: string) => void lines.push(line) };
}

/**
 * GDPR GAP-05: the API's request log must not record who called it. Fastify's default request
 * serializer writes the client's address, port and host; the app replaces it with method and
 * path only, bound to every line the request logs. These checks build a server with the app's
 * logger options and request bindings, log one line from a route and read it.
 */
async function logsFor(request: {
  url: string;
  headers?: Record<string, string>;
  remoteAddress?: string;
}) {
  const lines: string[] = [];
  const app = Fastify({
    logger: { ...loggerOptions(), stream: streamInto(lines) },
    childLoggerFactory: requestChildLogger(undefined),
  });
  app.get('/*', async (req) => {
    req.log.warn('seen');
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

  it('keeps no message line that only looks like a stack frame', () => {
    const note = 'first line\n    at my private note';
    const error = new DrizzleQueryError('insert into notes values ($1)', [note]);
    const fields = safeErrorFields(error);
    expect(JSON.stringify(fields)).not.toContain('my private note');
    expect(fields.stack?.split('\n').slice(1).length).toBeGreaterThan(0);
  });

  it('drops the stack of a database error whose message it cannot find there', () => {
    const error = new DrizzleQueryError('select 1', ['secret value']);
    error.stack = 'Error: rewritten\n    at secret value';
    expect(safeErrorFields(error)).toEqual({ type: 'DrizzleQueryError' });
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

const TRACE_ID = '105445aa7843bc8bf206b12000100000';

describe('request correlation', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetEnvCacheForTests();
  });

  async function healthWithFailingDatabase(project: string | undefined) {
    if (project) vi.stubEnv('GOOGLE_CLOUD_PROJECT', project);
    _resetEnvCacheForTests();
    const lines: string[] = [];
    const ctx = await buildTestApp({ logLines: lines });
    vi.spyOn(ctx.db, 'execute').mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    try {
      const res = await ctx.inject({
        method: 'GET',
        url: '/health?probe=1',
        headers: { 'x-cloud-trace-context': `${TRACE_ID}/1;o=1` },
      });
      expect(res.statusCode).toBe(503);
    } finally {
      await ctx.app.close();
    }
    return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }

  it('binds the Cloud Run trace and the redacted request to every line of a request', async () => {
    const lines = await healthWithFailingDatabase('wally-test');
    const line = lines.find((l) => l.type === 'health.database');
    expect(line?.['logging.googleapis.com/trace']).toBe(`projects/wally-test/traces/${TRACE_ID}`);
    expect(line?.req).toEqual({ method: 'GET', url: '/health' });
  });

  it('writes no per-request "incoming request" or "request completed" lines', async () => {
    const lines = await healthWithFailingDatabase(undefined);
    expect(JSON.stringify(lines)).not.toMatch(/incoming request|request completed/);
    expect(lines.find((l) => l.type === 'health.database')).not.toHaveProperty(
      'logging.googleapis.com/trace',
    );
  });

  it('reads the trace id from X-Cloud-Trace-Context', () =>
    expect(traceBindings(`${TRACE_ID}/1;o=1`, 'wally-test')).toEqual({
      'logging.googleapis.com/trace': `projects/wally-test/traces/${TRACE_ID}`,
    }));

  it.each([undefined, '', 'garbage', '/1;o=1', [] as string[]])(
    'omits the trace for header %j',
    (header) => expect(traceBindings(header, 'wally-test')).toEqual({}),
  );

  it('omits the trace without a project', () =>
    expect(traceBindings(`${TRACE_ID}/1;o=1`, undefined)).toEqual({}));
});
