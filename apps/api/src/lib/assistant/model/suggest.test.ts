import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APICallError } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import { createGoogleVertex } from '@ai-sdk/google-vertex';
import { createVertexAnthropic } from '@ai-sdk/google-vertex/anthropic';
import { suggestionCallSettings } from './config.js';
import { createSuggestionRunner, suggestionSchemaJson } from './suggest.js';
import type { AttemptInfo, ModelRef, TurnUsage } from './types.js';

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
/** The fields this reply proposes nothing for. */
const none = { title: null, reference: null, subtasks: null };
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
    const fields = {
      dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
      priority: null,
      assignee: null,
      title: { value: 'Müller anrufen', confidence: 0.8, reason: 'kürzer' },
      reference: { key: 'Kunde', value: 'Müller GmbH', confidence: 0.9, reason: 'Kunde genannt' },
      subtasks: {
        items: ['Unterlagen prüfen', 'Müller anrufen'],
        confidence: 0.7,
        reason: 'zwei Schritte',
      },
    };
    const model = new MockLanguageModelV3({ doGenerate: [reply(JSON.stringify(fields))] });
    const a = attempts();
    const out = await createSuggestionRunner(model)(input(a.onAttempt));
    expect(out.fields).toEqual(fields);
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

  it('makes one attempt and no retry on a retryable provider error, settling nothing', async () => {
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
    await expect(createSuggestionRunner(model)(input(a.onAttempt))).rejects.toMatchObject({
      statusCode: 503,
    });
    // maxRetries 0: the library would otherwise call again on a retryable error.
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(a.onAttempt).toHaveBeenCalledTimes(1);
    expect(a.settled).toEqual([]);
  });

  it('settles nothing when the provider reports no usage, so the reservation stays', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          ...reply(
            JSON.stringify({
              dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
              priority: null,
              assignee: null,
              ...none,
            }),
          ),
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
    const out = await createSuggestionRunner(model)(input(a.onAttempt));
    expect(out.usage).toBeNull();
    expect(a.onAttempt).toHaveBeenCalledTimes(1);
    expect(a.settled).toEqual([]);
  });

  it('returns no fields when the wire shape fits but the date or a member id does not', async () => {
    for (const fields of [
      {
        dueDate: { value: 'Freitag', confidence: 0.9, reason: 'Freitag' },
        priority: null,
        assignee: null,
        ...none,
      },
      // The right shape, but no such day: the stored record would fail the response schema.
      {
        dueDate: { value: '2026-04-31', confidence: 0.9, reason: 'Ende April' },
        priority: null,
        assignee: null,
        ...none,
      },
      {
        dueDate: null,
        priority: null,
        assignee: { memberId: '', confidence: 0.9, reason: 'Anna' },
        ...none,
      },
    ]) {
      const model = new MockLanguageModelV3({ doGenerate: [reply(JSON.stringify(fields))] });
      const a = attempts();
      const out = await createSuggestionRunner(model)(input(a.onAttempt));
      expect(out.fields, JSON.stringify(fields)).toBeNull();
      expect(a.settled).toHaveLength(1);
    }
  });

  it('drops only the optional field that breaks a length the wire leaves out, keeping the rest', async () => {
    const date = { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' };
    const base = { dueDate: date, priority: null, assignee: null, ...none };
    const steps = (items: string[]) => ({ items, confidence: 0.7, reason: 'Schritte' });
    const cases = {
      'a title over 200 characters': {
        ...base,
        title: { value: 'x'.repeat(300), confidence: 0.9, reason: 'kürzer' },
      },
      'an empty reference key': {
        ...base,
        reference: { key: '', value: 'Müller GmbH', confidence: 0.9, reason: 'Kunde' },
      },
      'an over-long reference value': {
        ...base,
        reference: { key: 'Kunde', value: 'x'.repeat(2_000), confidence: 0.9, reason: 'Kunde' },
      },
      'only blank steps': { ...base, subtasks: steps([' ', '']) },
      'an over-long step': { ...base, subtasks: steps(['Anrufen', 'x'.repeat(1_000)]) },
    };
    for (const [name, fields] of Object.entries(cases)) {
      const model = new MockLanguageModelV3({ doGenerate: [reply(JSON.stringify(fields))] });
      const a = attempts();
      const out = await createSuggestionRunner(model)(input(a.onAttempt));
      expect(out.fields, name).toEqual({ ...base });
      expect(a.settled, name).toHaveLength(1);
    }
  });

  it('keeps the first five of six steps, beside the date', async () => {
    const date = { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' };
    const steps = { items: ['a', 'b', 'c', 'd', 'e', 'f'], confidence: 0.7, reason: 'Schritte' };
    const model = new MockLanguageModelV3({
      doGenerate: [
        reply(
          JSON.stringify({
            dueDate: date,
            priority: null,
            assignee: null,
            ...none,
            subtasks: steps,
          }),
        ),
      ],
    });
    const out = await createSuggestionRunner(model)(input(attempts().onAttempt));
    expect(out.fields?.dueDate).toEqual(date);
    expect(out.fields?.subtasks).toEqual({ ...steps, items: ['a', 'b', 'c', 'd', 'e'] });
  });

  it('trims the steps and drops the blank and the doubled ones before counting five', async () => {
    const steps = {
      items: [' a', 'a', ' ', 'b ', 'c', 'd', 'e', 'f'],
      confidence: 0.7,
      reason: 'Schritte',
    };
    const model = new MockLanguageModelV3({
      doGenerate: [
        reply(
          JSON.stringify({
            dueDate: null,
            priority: null,
            assignee: null,
            ...none,
            subtasks: steps,
          }),
        ),
      ],
    });
    const out = await createSuggestionRunner(model)(input(attempts().onAttempt));
    expect(out.fields?.subtasks?.items).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('cuts a reason that runs long to 120 characters instead of dropping the proposal', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [
        reply(
          JSON.stringify({
            dueDate: null,
            priority: { value: 'HOCH', confidence: 0.9, reason: 'x'.repeat(200) },
            assignee: null,
            ...none,
          }),
        ),
      ],
    });
    const a = attempts();
    const out = await createSuggestionRunner(model)(input(a.onAttempt));
    expect(out.fields?.priority).toEqual({
      value: 'HOCH',
      confidence: 0.9,
      reason: 'x'.repeat(120),
    });
  });

  it('serialises the response schema it sends, for the reservation', async () => {
    const json = await suggestionSchemaJson();
    expect(JSON.parse(json)).toMatchObject({ type: 'object' });
    expect(json).toContain('dueDate');
    expect(json).toContain('memberId');
    expect(json).toContain('"subtasks"');
    expect(json).toContain('"reference"');
  });

  it('sends and announces the answer allowance plus the thinking room, with the options', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [reply('{}')] });
    const a = attempts();
    const providerOptions = { vertex: { thinkingConfig: { thinkingLevel: 'low' } } };
    await createSuggestionRunner(model, { providerOptions, thinkingTokens: 768 })(
      input(a.onAttempt),
    );
    expect(a.seen).toEqual([{ stepNumber: 0, messageCount: 1, maxOutputTokens: 1024 }]);
    expect(model.doGenerateCalls[0]!.maxOutputTokens).toBe(1024);
    expect(model.doGenerateCalls[0]!.providerOptions).toEqual(providerOptions);
  });
});

/** The parts of a Gemini request body these tests read. */
interface GeminiBody {
  generationConfig: {
    maxOutputTokens: number;
    thinkingConfig: unknown;
    responseMimeType: string;
    responseJsonSchema: unknown;
  };
}
/** The parts of an Anthropic Messages request body these tests read. */
interface ClaudeBody {
  max_tokens: number;
  thinking?: unknown;
  tools: { name: string }[];
  tool_choice: unknown;
}

/**
 * The configured settings, through the real Vertex provider with fetch stubbed (express-mode
 * key, so no sign-in and no network): what the request body carries is what Vertex would get.
 */
describe('a suggestion call as it reaches Vertex', () => {
  const answer = JSON.stringify({ dueDate: null, priority: null, assignee: null, ...none });
  async function send(ref: ModelRef) {
    const bodies: GeminiBody[] = [];
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as never);
      return new Response(
        JSON.stringify({
          candidates: [
            { content: { role: 'model', parts: [{ text: answer }] }, finishReason: 'STOP' },
          ],
          usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 12, totalTokenCount: 52 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const model = createGoogleVertex({ apiKey: 'test-key', fetch })(ref.model);
    const a = attempts();
    const out = await createSuggestionRunner(
      model,
      suggestionCallSettings(ref),
    )(input(a.onAttempt));
    expect(out.fields).toEqual({ dueDate: null, priority: null, assignee: null, ...none });
    expect(bodies).toHaveLength(1);
    return { body: bodies[0]!, announced: a.seen[0]!.maxOutputTokens };
  }

  it('keeps thinking inside the allowance it announces, leaving the answer its 256', async () => {
    for (const [model, thinking, total] of [
      ['gemini-2.5-flash', { thinkingBudget: 0 }, 256],
      ['gemini-2.5-flash-lite', { thinkingBudget: 0 }, 256],
      ['gemini-2.5-pro', { thinkingBudget: 128 }, 384],
      ['gemini-3.8-flash', { thinkingLevel: 'low' }, 1024],
    ] as const) {
      const { body, announced } = await send({ provider: 'vertex', model });
      const config = body.generationConfig;
      expect(config.thinkingConfig, model).toEqual(thinking);
      expect(config.maxOutputTokens, model).toBe(total);
      expect(announced, model).toBe(total);
      if ('thinkingBudget' in thinking)
        expect(config.maxOutputTokens - thinking.thinkingBudget, model).toBe(256);
    }
  });

  it('sends only schema keywords Gemini documents for structured output, and the library header', async () => {
    const { body } = await send({ provider: 'vertex', model: 'gemini-2.5-flash' });
    const schema = body.generationConfig.responseJsonSchema;
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    const keywords = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        keywords.add(key);
        if (key === 'properties') Object.values(value as object).forEach(walk);
        else if (key === 'anyOf') (value as unknown[]).forEach(walk);
        else if (key === 'items') walk(value);
      }
    };
    walk(schema);
    // `$schema` is the library's own header on every schema it sends; the page does not list it.
    const documented = [
      '$schema',
      'type',
      'properties',
      'required',
      'additionalProperties',
      'enum',
      'minimum',
      'maximum',
      'anyOf',
      'items',
      'maxItems',
      'description',
    ];
    expect([...keywords].filter((k) => !documented.includes(k))).toEqual([]);
    expect(keywords).not.toContain('pattern');
    expect(keywords).not.toContain('maxLength');
    // The step count is one the page documents for arrays, so the provider is told it too.
    type Node = { properties?: Record<string, Node>; anyOf?: Node[]; type?: unknown };
    const subtasks = (schema as Node).properties!.subtasks!;
    const branch = subtasks.anyOf?.find((n) => n.type === 'object') ?? subtasks;
    expect(branch.properties!.items).toMatchObject({ type: 'array', maxItems: 5 });
  });
});

/** Claude on Vertex, with fetch and the sign-in stubbed: how the same call reaches Anthropic's API. */
describe('a suggestion call as it reaches Claude on Vertex', () => {
  const g = globalThis as { AI_SDK_LOG_WARNINGS?: boolean };
  beforeAll(() => void (g.AI_SDK_LOG_WARNINGS = false));
  afterAll(() => void delete g.AI_SDK_LOG_WARNINGS);
  it('asks for the schema through a JSON tool within the allowance, and reads its input back', async () => {
    const bodies: ClaudeBody[] = [];
    const fields = {
      dueDate: { value: '2026-10-23', confidence: 0.9, reason: 'Freitag' },
      priority: null,
      assignee: null,
      ...none,
    };
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as never);
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-5-5',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'json', input: fields }],
          stop_reason: 'tool_use',
          stop_sequence: null,
          usage: { input_tokens: 40, output_tokens: 30 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const ref: ModelRef = { provider: 'vertex-anthropic', model: 'claude-sonnet-5-5' };
    const model = createVertexAnthropic({
      project: 'wally-test',
      location: 'europe-west1',
      generateAuthToken: async () => 'test-token',
      fetch,
    })(ref.model);
    const a = attempts();
    const out = await createSuggestionRunner(
      model,
      suggestionCallSettings(ref),
    )(input(a.onAttempt));
    expect(out.fields).toEqual(fields);
    expect(a.seen[0]!.maxOutputTokens).toBe(256);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.max_tokens).toBe(256);
    expect(bodies[0]!.thinking).toBeUndefined();
    expect(bodies[0]!.tools.map((t) => t.name)).toEqual(['json']);
    // Vertex has no native output format here, and this model refuses a forced tool, so the
    // library offers the JSON tool without forcing it (and warns): a prose reply is "nothing".
    expect(bodies[0]!.tool_choice).toMatchObject({ type: 'auto' });
    expect(a.settled).toEqual([
      { inputTokens: 40, cachedInputTokens: 0, outputTokens: 30, reasoningTokens: 0 },
    ]);
  });
});
