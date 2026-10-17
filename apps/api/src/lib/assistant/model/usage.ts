import type { LanguageModelUsage } from 'ai';
import type { TurnUsage } from './types.js';

const isCount = (n: number | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Null when the provider did not report a usable input or output count. */
export function toUsage(usage: LanguageModelUsage): TurnUsage | null {
  const { inputTokens, outputTokens } = usage;
  if (!isCount(inputTokens) || !isCount(outputTokens)) return null;
  return {
    inputTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens ?? 0,
    outputTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens ?? 0,
  };
}
