import { describe, expect, it } from 'vitest';
import { TIDY_MAX_UNDATED } from '@wally/shared';
import { APICallError, zodSchema } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { createTidyRunner, modelTidySchema, modelTidyWireSchema, tidySchemaJson } from './tidy.js';
import { fakeReply as reply, recordAttempts as attempts } from './testing.js';
import type { TidyInput } from './types.js';

/** Spellings from before ADR-0024; a move that carries one is dropped, never stored. */
const OLD = { horizon: 'DIESE_WOCHE' } as const;

describe('modelTidySchema', () => {
  it('accepts THIS_WEEK and drops a move with an old spelling', () => {
    const checked = modelTidySchema.parse({
      moves: [
        { noteId: 'n1', horizon: 'THIS_WEEK', confidence: 0.9, reason: 'by Friday' },
        { noteId: 'n2', horizon: OLD.horizon, confidence: 0.9, reason: 'by Friday' },
      ],
    });
    expect(checked.moves).toEqual([
      { noteId: 'n1', horizon: 'THIS_WEEK', confidence: 0.9, reason: 'by Friday' },
    ]);
  });

  it('keeps well-formed moves and cuts a long reason', () => {
    const checked = modelTidySchema.parse({
      moves: [
        { noteId: 'n1', horizon: 'LATER', confidence: 0.9, reason: 'x'.repeat(200) },
        { noteId: 'n2', horizon: 'THIS_WEEK', confidence: 0.7, reason: 'by Friday' },
      ],
    });
    expect(checked.moves).toHaveLength(2);
    expect(checked.moves[0]!.reason).toHaveLength(120);
  });

  it('drops a move that does not fit instead of refusing the reply', () => {
    const checked = modelTidySchema.parse({
      moves: [
        { noteId: '', horizon: 'LATER', confidence: 0.9, reason: 'no id' },
        { noteId: 'n2', horizon: 'TODAY', confidence: 0.9, reason: 'not away from today' },
        { noteId: 'n3', horizon: 'LATER', confidence: 1.5, reason: 'too sure' },
        { noteId: 'n4', horizon: 'LATER', confidence: 0.8, reason: 'fine' },
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

const input = (onAttempt: TidyInput['onAttempt']) => ({
  instructions: 'Place the notes.',
  prompt: 'Notes in Today, newest first:\nn1: Plan the offsite next month',
  maxOutputTokens: 256,
  onAttempt,
});

describe('createTidyRunner', () => {
  it('returns the validated moves and settles one attempt', async () => {
    const moves = {
      moves: [{ noteId: 'n1', horizon: 'LATER', confidence: 0.9, reason: 'next month' }],
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

  it('rethrows a provider error status, settling it at zero so the slot is free', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new APICallError({
          message: 'overloaded',
          url: 'https://example.invalid',
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        });
      },
    });
    const a = attempts();
    await expect(createTidyRunner(model)(input(a.onAttempt))).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(a.seen).toHaveLength(1);
    expect(a.settled).toEqual([
      { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    ]);
    expect(a.released).toEqual([]);
  });

  it('passes the provider error through, releasing the attempt, when settling it at zero fails', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw Object.assign(new Error('quota'), { name: 'AI_APICallError', statusCode: 429 });
      },
    });
    const released: string[] = [];
    const onAttempt = async () => ({
      settle: async () => {
        throw new Error('datastore unavailable');
      },
      release: () => void released.push('released'),
    });
    await expect(createTidyRunner(model)(input(onAttempt))).rejects.toMatchObject({
      name: 'AI_APICallError',
      statusCode: 429,
    });
    expect(released).toEqual(['released']);
  });

  it('releases the attempt, keeping its charge, when the connection dropped and the usage is unknown', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new TypeError('fetch failed');
      },
    });
    const a = attempts();
    await expect(createTidyRunner(model)(input(a.onAttempt))).rejects.toBeInstanceOf(TypeError);
    expect(a.settled).toEqual([]);
    expect(a.released).toHaveLength(1);
  });

  it('releases the attempt when the provider reports no usage', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          ...reply('{"moves":[]}'),
          usage: {
            inputTokens: {
              total: undefined,
              noCache: undefined,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: undefined, text: undefined, reasoning: undefined },
          },
        },
      ],
    });
    const a = attempts();
    const out = await createTidyRunner(model)(input(a.onAttempt));
    expect(out.usage).toBeNull();
    expect(a.settled).toEqual([]);
    expect(a.released).toHaveLength(1);
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
