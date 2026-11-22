import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';
import { redactQuotedPaths } from './redact.js';

/**
 * What a log line may say about an error, under OpenTelemetry's Stable attribute names
 * (RFC-0012 §5 rule 6): `exception.*` for the error
 * (https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/), `error.type` for
 * its class (https://opentelemetry.io/docs/specs/semconv/registry/attributes/error/) and
 * `db.response.status_code` for a code the database returned
 * (https://opentelemetry.io/docs/specs/semconv/registry/attributes/db/).
 */
export interface SafeErrorFields {
  'exception.type': string;
  'exception.message'?: string;
  'exception.stacktrace'?: string;
  /** The first string `code` along the cause chain, else the error's type. */
  'error.type': string;
  /** That code, when Postgres returned it (a `PostgresError` carries it). */
  'db.response.status_code'?: string;
}

/**
 * Errors whose message can quote their input: the database's (Postgres repeats values, Drizzle
 * carries the query and its parameters), Zod's (`received: …`) and JSON.parse's. Known also by
 * name, so a second copy of a driver, whose classes `instanceof` cannot see, is still caught.
 */
const QUOTING_ERRORS = new Set(['DrizzleQueryError', 'PostgresError', 'ZodError', 'SyntaxError']);
/** How many `cause` links are followed: Wally wraps a database error at most twice. */
const MAX_CAUSES = 3;

function quotesInput(error: unknown): boolean {
  if (error instanceof DrizzleQueryError || error instanceof postgres.PostgresError) return true;
  const name = (error as { name?: unknown } | null)?.name;
  return (
    QUOTING_ERRORS.has(typeOf(error)) || (typeof name === 'string' && QUOTING_ERRORS.has(name))
  );
}

/** The error and its causes, nearest first. */
function causeChain(error: unknown): unknown[] {
  const chain = [error];
  let current = error;
  while (chain.length <= MAX_CAUSES && current !== null && typeof current === 'object') {
    current = (current as { cause?: unknown }).cause;
    if (current === undefined) break;
    chain.push(current);
  }
  return chain;
}

function typeOf(error: unknown): string {
  if (error === null) return 'null';
  if (typeof error !== 'object') return typeof error;
  const named = error as { constructor?: { name?: unknown }; name?: unknown };
  // DrizzleQueryError sets no `name`, so the constructor names it.
  const name = named.constructor?.name;
  if (typeof name === 'string' && name && name !== 'Object') return name;
  return typeof named.name === 'string' && named.name ? named.name : 'object';
}

function stringCode(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isPostgresError(error: unknown): boolean {
  return error instanceof postgres.PostgresError || typeOf(error) === 'PostgresError';
}

/**
 * A stack's frames without its header, which repeats the message. The header is cut at the end
 * of the message, not by the lines that look like frames: a parameter value can contain
 * "\n    at …" too. A stack whose message cannot be found is dropped whole.
 */
function framesAfterMessage(stack: string | undefined, message: unknown): string[] | undefined {
  if (!stack || typeof message !== 'string') return undefined;
  const end = stack.indexOf(message);
  if (end < 0) return undefined;
  const frames = stack
    .slice(end + message.length)
    .split('\n')
    .filter((line) => line.startsWith('    at '));
  return frames.length ? frames : undefined;
}

/**
 * The fields of an error a log line keeps: its type, message, stack and string `code`, nothing
 * else, since an error's other properties can hold request data. An error that can quote its
 * input (`QUOTING_ERRORS`), or has one among its causes, keeps no message: Postgres can repeat
 * the input (`invalid input syntax for type uuid: "…"`) and Drizzle's `DrizzleQueryError`
 * carries the query and its parameters, which can be a note's text. It keeps a stack without
 * the lines that repeat the message. `error.type` is the first string code along the cause
 * chain, so a SQLSTATE under a wrapper is kept. Any other message keeps its quoted paths
 * redacted.
 */
export function safeErrorFields(error: unknown): SafeErrorFields {
  const type = typeOf(error);
  if (error === null || typeof error !== 'object')
    return { 'exception.type': type, 'error.type': type };
  const failure = error as { message?: unknown; stack?: unknown };
  const stack = typeof failure.stack === 'string' ? failure.stack : undefined;
  const chain = causeChain(error);
  const coded = chain.find((link) => stringCode((link as { code?: unknown } | null)?.code));
  const code = stringCode((coded as { code?: unknown } | undefined)?.code);
  const codeFields = {
    'error.type': code ?? type,
    ...(code && isPostgresError(coded) ? { 'db.response.status_code': code } : {}),
  };
  if (chain.some(quotesInput)) {
    const frames = framesAfterMessage(stack, failure.message);
    return {
      'exception.type': type,
      ...(frames ? { 'exception.stacktrace': [type, ...frames].join('\n') } : {}),
      ...codeFields,
    };
  }
  return {
    'exception.type': type,
    ...(typeof failure.message === 'string'
      ? { 'exception.message': redactQuotedPaths(failure.message) }
      : {}),
    ...(stack ? { 'exception.stacktrace': redactQuotedPaths(stack) } : {}),
    ...codeFields,
  };
}
