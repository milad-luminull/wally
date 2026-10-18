import { describe, expect, it, vi } from 'vitest';
import { TIDY_MAX_UNDATED } from '@wally/shared';
import { zodSchema } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { createTidyRunner, modelTidySchema, modelTidyWireSchema, tidySchemaJson } from './tidy.js';
import type { AttemptInfo, TurnUsage } from './types.js';

describe('modelTidySchema', () => {
  it('keeps well-formed moves and cuts a long reason', () => {
    const checked = modelTidySchema.parse({
      moves: [
        { noteId: 'n1', horizon: 'SPAETER', confidence: 0.9, reason: 'x'.repeat(200) },
        { noteId: 'n2', horizon: 'DIESE_WOCHE', confidence: 0.7, reason: 'by Friday' },
      ],
    });
    expect(checked.moves).toHaveLength(2);
    expect(checked.moves[0]!.reason).toHaveLength(120);
  });

  it('drops a move that does not fit instead of refusing the reply', () => {
    const checked = modelTidySchema.parse({
      moves: [
        { noteId: '', horizon: 'SPAETER', confidence: 0.9, reason: 'no id' },
        { noteId: 'n2', horizon: 'HEUTE', confidence: 0.9, reason: 'not away from today' },
        { noteId: 'n3', horizon: 'SPAETER', confidence: 1.5, reason: 'too sure' },
        { noteId: 'n4', horizon: 'SPAETER', confidence: 0.8, reason: 'fine' },
      ],
    });
    expect(checked.moves.map((m) => m.noteId)).toEqual(['n4']);
  });

  it('sends only the keywords Gemini documents, with maxItems on the list', async () => {
    const json = JSON.parse(await tidySchemaJson()) as Record<string, unknown>;
    const text = JSON.stringify(json);
    for (const banned of ['pattern', 'minLength', 'maxLength', 'format', 'minItems'])
      expect(text).not.toContain(`"${banned}"`);
    const moves = (json.properties as Record<string, { maxItems?: number }>).moves;
    expect(moves!.maxItems).toBe(TIDY_MAX_UNDATED);
    expect(JSON.stringify(zodSchema(modelTidyWireSchema).jsonSchema)).toBe(text);
  });
});

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
  instructions: 'Place the notes.',
  prompt: 'Notes in Today, newest first:\nn1: Plan the offsite next month',
  maxOutputTokens: 256,
  onAttempt,
});

describe('createTidyRunner', () => {
  it('returns the validated moves and settles one attempt', async () => {
    const moves = {
      moves: [{ noteId: 'n1', horizon: 'SPAETER', confidence: 0.9, reason: 'next month' }],
    };
    const model = new MockLanguageModelV3({ doGenerate: [reply(JSON.stringify(moves))] });
    const a = attempts();
    const out = await createTidyRunner(model)(input(a.onAttempt));
    expect(out.moves).toEqual(moves);
    expect(out.finishReason).toBe('stop');
    expect(a.seen).toEqual([{ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 }]);
    expect(a.settled).toEqual([
      { inputTokens: 40, cachedInputTokens: 0, outputTokens: 12, reasoningTokens: 0 },
    ]);
  });

  it('returns no moves, and still settles, when the output does not validate', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [reply(JSON.stringify({ moves: 'n1 to Later' }))],
    });
    const a = attempts();
    const out = await createTidyRunner(model)(input(a.onAttempt));
    expect(out.moves).toBeNull();
    expect(a.settled).toHaveLength(1);
  });

  it('sends and announces the answer allowance plus the thinking room, with the options', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [reply('{"moves":[]}')] });
    const a = attempts();
    const providerOptions = { vertex: { thinkingConfig: { thinkingLevel: 'low' } } };
    await createTidyRunner(model, { providerOptions, thinkingTokens: 768 })(input(a.onAttempt));
    expect(a.seen).toEqual([{ stepNumber: 0, messageCount: 1, maxOutputTokens: 1024 }]);
    expect(model.doGenerateCalls[0]!.maxOutputTokens).toBe(1024);
    expect(model.doGenerateCalls[0]!.providerOptions).toEqual(providerOptions);
  });
});
