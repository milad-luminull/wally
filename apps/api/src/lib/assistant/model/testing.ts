import type { AttemptInfo, TurnUsage } from './types.js';

/**
 * The fake model's pieces the structured-call suites share (suggest.test.ts, tidy.test.ts):
 * a usage report, a text reply in the provider's shape, and an attempt hook that records what
 * it was told, what it settled and which attempts it released without usage. Test-only:
 * tsconfig.build.json leaves it out of dist.
 */
export const fakeUsage = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 12, text: 12, reasoning: 0 },
};

export const fakeReply = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage: fakeUsage,
  warnings: [],
});

export function recordAttempts() {
  const seen: AttemptInfo[] = [];
  const settled: TurnUsage[] = [];
  const released: AttemptInfo[] = [];
  const onAttempt = async (info: AttemptInfo) => {
    seen.push(info);
    return {
      settle: (u: TurnUsage) => void settled.push(u),
      release: () => void released.push(info),
    };
  };
  return { onAttempt, seen, settled, released };
}
