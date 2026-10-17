import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { createSuggestionRunner } from './suggest.js';
import type { AttemptInfo, TurnUsage } from './types.js';

const usage = {
  inputTokens: { total: 40, noCache: 40, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 12, text: 12, reasoning: 0 },
};
const reply = (text: string) => ({
  content: [{ type: 'text' as const, text }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
  warnings: [],
});
function attempts() {
  const seen: AttemptInfo[] = [];
  const settled: TurnUsage[] = [];
  const onAttempt = vi.fn(async (info: AttemptInfo) => {
    seen.push(info);
    return { settle: (u: TurnUsage) => void settled.push(u) };
  });
  return { onAttempt, seen, settled };
}
const input = (onAttempt: ReturnType<typeof attempts>['onAttempt']) => ({
  instructions: 'Fill in the fields.',
  prompt: 'Title: Müller anrufen Freitag',
  maxOutputTokens: 256,
  onAttempt,
});

describe('createSuggestionRunner', () => {
  it('returns the validated fields and settles one attempt', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        reply(
          JSON.stringify({
            dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
            priority: null,
            assignee: null,
          }),
        ),
      ],
    });
    const a = attempts();
    const out = await createSuggestionRunner(model)(input(a.onAttempt));
    expect(out.fields).toEqual({
      dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
      priority: null,
      assignee: null,
    });
    expect(out.finishReason).toBe('stop');
    expect(a.seen).toEqual([{ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 }]);
    expect(a.settled).toEqual([
      { inputTokens: 40, cachedInputTokens: 0, outputTokens: 12, reasoningTokens: 0 },
    ]);
  });

  it('returns no fields, and still settles, when the output does not validate', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [reply(JSON.stringify({ dueDate: { value: 'Freitag' } }))],
    });
    const a = attempts();
    const out = await createSuggestionRunner(model)(input(a.onAttempt));
    expect(out.fields).toBeNull();
    expect(a.settled).toHaveLength(1);
  });

  it('returns no fields when the reply is not JSON at all', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [reply('Am Freitag.')] });
    const a = attempts();
    const out = await createSuggestionRunner(model)(input(a.onAttempt));
    expect(out.fields).toBeNull();
  });

  it('does not call the model when the attempt is refused', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [reply('{}')] });
    const onAttempt = vi.fn(async () => {
      throw new Error('ASSISTANT_BUSY');
    });
    await expect(createSuggestionRunner(model)(input(onAttempt))).rejects.toThrow('ASSISTANT_BUSY');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('passes the provider error through unchanged', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw Object.assign(new Error('quota'), { name: 'AI_APICallError', statusCode: 429 });
      },
    });
    const a = attempts();
    await expect(createSuggestionRunner(model)(input(a.onAttempt))).rejects.toMatchObject({
      name: 'AI_APICallError',
    });
  });
});
