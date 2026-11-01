import type { FinishReason } from 'ai';
import type { TurnFinishReason } from './types.js';

/**
 * The library's finish reason in Wally's terms. Exhaustive on purpose: a reason a library
 * update adds fails the typecheck here until Wally decides what it means.
 */
export function toFinishReason(reason: FinishReason): TurnFinishReason {
  switch (reason) {
    case 'stop':
    case 'length':
    case 'content-filter':
    case 'tool-calls':
    case 'error':
    case 'other':
      return reason;
    // The reply ended without the provider's completion signal: what arrived is kept, the
    // rest is missing. That is an answer cut short, as when the token allowance runs out.
    case 'interrupted':
      return 'length';
  }
}
