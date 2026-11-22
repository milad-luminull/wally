import { DrizzleQueryError } from 'drizzle-orm';
import postgres from 'postgres';

/** What a log line may say about an error (RFC-0012 §7, workstream 1). */
export interface SafeErrorFields {
  type: string;
  message?: string;
  stack?: string;
  code?: string;
}

function isDatabaseError(error: unknown): boolean {
  return error instanceof DrizzleQueryError || error instanceof postgres.PostgresError;
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
 * else, since an error's other properties can hold request data. A database error keeps no
 * message: Postgres can repeat the input (`invalid input syntax for type uuid: "…"`) and
 * Drizzle's `DrizzleQueryError` carries the query and its parameters, which can be a note's
 * text. It keeps its SQLSTATE `code` (read as `classifyDatabaseError` reads it) and a stack
 * without the lines that repeat the message.
 */
export function safeErrorFields(error: unknown): SafeErrorFields {
  const type = typeOf(error);
  if (error === null || typeof error !== 'object') return { type };
  const failure = error as { message?: unknown; stack?: unknown; code?: unknown; cause?: unknown };
  const stack = typeof failure.stack === 'string' ? failure.stack : undefined;
  if (isDatabaseError(error) || isDatabaseError(failure.cause)) {
    const code =
      stringCode(failure.code) ?? stringCode((failure.cause as { code?: unknown } | null)?.code);
    const frames = framesAfterMessage(stack, failure.message);
    return {
      type,
      ...(frames ? { stack: [type, ...frames].join('\n') } : {}),
      ...(code ? { code } : {}),
    };
  }
  const code = stringCode(failure.code);
  return {
    type,
    ...(typeof failure.message === 'string' ? { message: failure.message } : {}),
    ...(stack ? { stack } : {}),
    ...(code ? { code } : {}),
  };
}
