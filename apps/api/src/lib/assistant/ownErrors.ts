/**
 * Errors raised by Wally's own callbacks (the ledger, the conversation store) pass through a
 * model runner unchanged. Anything else the runner throws came from the model provider.
 */
const ownErrors = new WeakSet<object>();

/** Marks an error as Wally's own and returns it, for `throw own(error)`. */
export function own(error: unknown): unknown {
  if (error !== null && typeof error === 'object') ownErrors.add(error);
  return error;
}

/** Whether `own` marked this error. */
export function isOwn(error: unknown): boolean {
  return error !== null && typeof error === 'object' && ownErrors.has(error);
}
