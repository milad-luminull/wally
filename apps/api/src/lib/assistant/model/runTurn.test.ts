import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { createTurnRunner, ELIDED_TOOL_RESULT, toolDefinitionsJson } from './runTurn.js';
import type { AttemptInfo, TurnInput, TurnTool, TurnUsage } from './types.js';

const usage = {
  inputTokens: { total: 10, noCache: 8, cacheRead: 2, cacheWrite: 0 },
  outputTokens: { total: 5, text: 4, reasoning: 1 },
};
const text = (t: string) => ({
  content: [{ type: 'text' as const, text: t }],
  finishReason: { unified: 'stop' as const, raw: undefined },
  usage,
  warnings: [],
});
const toolCall = (toolCallId: string, toolName: string, input: Record<string, unknown>) => ({
  content: [{ type: 'tool-call' as const, toolCallId, toolName, input: JSON.stringify(input) }],
  finishReason: { unified: 'tool-calls' as const, raw: undefined },
  usage,
  warnings: [],
});

function tools(overrides: Partial<Record<'list_notes' | 'create_note', Partial<TurnTool>>> = {}) {
  const list: TurnTool = {
    name: 'list_notes',
    description: 'List notes',
    inputSchema: z.object({ boardId: z.string() }).strict(),
    needsApproval: false,
    execute: vi.fn(async () => ({ notes: [], truncated: false, total: 0 })),
    ...overrides.list_notes,
  };
  const create: TurnTool = {
    name: 'create_note',
    description: 'Create a note',
    inputSchema: z.object({ boardId: z.string(), input: z.object({ title: z.string() }) }).strict(),
    needsApproval: true,
    execute: vi.fn(async () => ({ id: 'n1', revision: 1 })),
    ...overrides.create_note,
  };
  return { list, create };
}

function attempts() {
  const seen: AttemptInfo[] = [];
  const settled: TurnUsage[] = [];
  const released: number[] = [];
  /** Every attempt's reserve, settle and release, in order, by step number. */
  const log: string[] = [];
  const onAttempt = vi.fn(async (info: AttemptInfo) => {
    seen.push(info);
    log.push(`reserve ${info.stepNumber}`);
    return {
      settle: (u: TurnUsage) => {
        settled.push(u);
        log.push(`settle ${info.stepNumber}`);
      },
      release: () => {
        released.push(info.stepNumber);
        log.push(`release ${info.stepNumber}`);
      },
    };
  });
  return { onAttempt, seen, settled, released, log };
}

function input(partial: Partial<TurnInput>, t = tools()): TurnInput {
  return {
    instructions: 'You are Wally.',
    history: [],
    userMessage: 'What is open today?',
    tools: [t.list, t.create],
    maxOutputTokens: 256,
    maxSteps: 4,
    onAttempt: attempts().onAttempt,
    ...partial,
  };
}

describe('createTurnRunner', () => {
  it('returns the text of the reply and settles one attempt per step', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('Nichts offen.')],
    });
    const a = attempts();
    const out = await createTurnRunner(model)(input({ onAttempt: a.onAttempt }));
    expect(out.text).toBe('Nichts offen.');
    expect(out.finishReason).toBe('stop');
    expect(out.steps).toBe(2);
    expect(out.pendingApprovals).toEqual([]);
    expect(a.seen).toEqual([
      { stepNumber: 0, messageCount: 1, maxOutputTokens: 256 },
      { stepNumber: 1, messageCount: 3, maxOutputTokens: 256 },
    ]);
    expect(a.settled).toEqual([
      { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningTokens: 1 },
      { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningTokens: 1 },
    ]);
    expect(a.released).toEqual([]);
    expect(out.unsettledSteps).toBe(0);
    expect(out.usage).toEqual({
      inputTokens: 20,
      cachedInputTokens: 4,
      outputTokens: 10,
      reasoningTokens: 2,
    });
    expect(out.messages.length).toBeGreaterThan(1);
  });

  it('rejects a question answered without reading, after announcing its one attempt', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [text('Nichts offen.')] });
    const a = attempts();
    await expect(createTurnRunner(model)(input({ onAttempt: a.onAttempt }))).rejects.toMatchObject({
      name: 'AI_ToolChoiceViolationError',
    });
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(a.seen).toEqual([{ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 }]);
    // The library throws before the step ends: the usage is unknown, so the attempt is
    // released, keeping its charge, as for any provider error.
    expect(a.settled).toEqual([]);
    expect(a.released).toEqual([0]);
  });

  it('executes a read tool and continues to the answer, one attempt per step', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('Three notes.')],
    });
    const a = attempts();
    const out = await createTurnRunner(model)(input({ onAttempt: a.onAttempt }, t));
    expect(t.list.execute).toHaveBeenCalledWith({ boardId: 'b1' });
    expect(out.toolCalls).toEqual([
      {
        toolCallId: 'c1',
        toolName: 'list_notes',
        input: { boardId: 'b1' },
        output: { notes: [], truncated: false, total: 0 },
      },
    ]);
    expect(out.text).toBe('Three notes.');
    expect(out.steps).toBe(2);
    expect(a.seen.map((s) => s.stepNumber)).toEqual([0, 1]);
    expect(a.settled).toHaveLength(2);
    expect(out.usage.inputTokens).toBe(20);
  });

  it('requires a tool call on the first step of a question, and leaves later steps automatic', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('Three notes.')],
    });
    const a = attempts();
    await createTurnRunner(model)(
      input({ userMessage: 'What is overdue?', onAttempt: a.onAttempt }, t),
    );
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(model.doGenerateCalls[0]!.toolChoice).toEqual({ type: 'required' });
    expect(model.doGenerateCalls[1]!.toolChoice).not.toEqual({ type: 'required' });
    // The ledger sees the forced step like any other.
    expect(a.seen.map((s) => s.stepNumber)).toEqual([0, 1]);
    expect(a.settled).toHaveLength(2);
  });

  it('does not force a tool call on a continuation that answers approvals', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'x' } })],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    for (const approved of [true, false]) {
      const second = new MockLanguageModelV3({ doGenerate: [text('Finished.')] });
      const out = await createTurnRunner(second)(
        input(
          {
            history: paused.messages,
            userMessage: undefined,
            approvals: [{ approvalId: paused.pendingApprovals[0]!.approvalId, approved }],
          },
          t,
        ),
      );
      expect(out.text).toBe('Finished.');
      expect(second.doGenerateCalls).toHaveLength(1);
      expect(second.doGenerateCalls[0]!.toolChoice).not.toEqual({ type: 'required' });
    }
  });

  it('pauses a write tool as a pending approval and never executes it', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Call Müller' } }),
      ],
    });
    const out = await createTurnRunner(model)(input({}, t));
    expect(t.create.execute).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(out.pendingApprovals).toHaveLength(1);
    expect(out.pendingApprovals[0]).toMatchObject({
      toolCallId: 'c2',
      toolName: 'create_note',
      input: { boardId: 'b1', input: { title: 'Call Müller' } },
    });
    expect(out.pendingApprovals[0]!.approvalId).toEqual(expect.any(String));
    expect(out.finishReason).toBe('tool-calls');
  });

  it('executes the write on the continuation that approves it', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Call Müller' } }),
      ],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('Done.')] });
    const out = await createTurnRunner(second)(
      input(
        {
          history: paused.messages,
          userMessage: undefined,
          approvals: [{ approvalId: paused.pendingApprovals[0]!.approvalId, approved: true }],
        },
        t,
      ),
    );
    expect(t.create.execute).toHaveBeenCalledTimes(1);
    expect(t.create.execute).toHaveBeenCalledWith({
      boardId: 'b1',
      input: { title: 'Call Müller' },
    });
    expect(out.toolCalls[0]).toMatchObject({
      toolName: 'create_note',
      output: { id: 'n1', revision: 1 },
    });
    expect(out.text).toBe('Done.');
    expect(out.pendingApprovals).toEqual([]);
  });

  it('announces the first attempt of an approving continuation before the write runs', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Call Müller' } }),
      ],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('Done.')] });
    const a = attempts();
    await createTurnRunner(second)(
      input(
        {
          history: paused.messages,
          userMessage: undefined,
          approvals: [{ approvalId: paused.pendingApprovals[0]!.approvalId, approved: true }],
          onAttempt: a.onAttempt,
        },
        t,
      ),
    );
    // History, the approval message, and the tool message holding the write's result.
    expect(a.seen).toEqual([
      { stepNumber: 0, messageCount: paused.messages.length + 2, maxOutputTokens: 256 },
    ]);
    expect(a.settled).toHaveLength(1);
    expect(a.onAttempt.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(t.create.execute).mock.invocationCallOrder[0]!,
    );
  });

  it('does not run an approved write when the first attempt is refused', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Call Müller' } }),
      ],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('never')] });
    const onAttempt = vi.fn(async () => {
      throw new Error('OVER_BUDGET');
    });
    await expect(
      createTurnRunner(second)(
        input(
          {
            history: paused.messages,
            userMessage: undefined,
            approvals: [{ approvalId: paused.pendingApprovals[0]!.approvalId, approved: true }],
            onAttempt,
          },
          t,
        ),
      ),
    ).rejects.toThrow('OVER_BUDGET');
    expect(onAttempt).toHaveBeenCalledTimes(1);
    expect(t.create.execute).not.toHaveBeenCalled();
    expect(second.doGenerateCalls).toHaveLength(0);
  });

  it('rejects a turn that carries both a user message and approval decisions', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Call Müller' } }),
      ],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('never')] });
    const a = attempts();
    await expect(
      createTurnRunner(second)(
        input(
          {
            history: paused.messages,
            userMessage: 'And one more thing',
            approvals: [{ approvalId: paused.pendingApprovals[0]!.approvalId, approved: true }],
            onAttempt: a.onAttempt,
          },
          t,
        ),
      ),
    ).rejects.toThrow('A turn carries either a user message or approval decisions, not both');
    expect(second.doGenerateCalls).toHaveLength(0);
    expect(t.create.execute).not.toHaveBeenCalled();
    expect(a.onAttempt).not.toHaveBeenCalled();
  });

  it('proposes and executes a write with its schema-parsed input', async () => {
    const t = tools({
      create_note: {
        inputSchema: z
          .object({
            boardId: z.string().default('b1'),
            title: z.string().transform((s) => s.trim()),
          })
          .strict(),
      },
    });
    const first = new MockLanguageModelV3({
      doGenerate: [toolCall('c3', 'create_note', { title: '  T  ' })],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    expect(t.create.execute).not.toHaveBeenCalled();
    expect(paused.pendingApprovals).toHaveLength(1);
    expect(paused.pendingApprovals[0]!.input).toEqual({ boardId: 'b1', title: 'T' });

    const second = new MockLanguageModelV3({ doGenerate: [text('Done.')] });
    const out = await createTurnRunner(second)(
      input(
        {
          history: paused.messages,
          userMessage: undefined,
          approvals: [{ approvalId: paused.pendingApprovals[0]!.approvalId, approved: true }],
        },
        t,
      ),
    );
    expect(t.create.execute).toHaveBeenCalledTimes(1);
    expect(t.create.execute).toHaveBeenCalledWith({ boardId: 'b1', title: 'T' });
    expect(out.toolCalls).toHaveLength(1);
    expect(out.toolCalls[0]).toMatchObject({
      toolCallId: 'c3',
      toolName: 'create_note',
      input: { boardId: 'b1', title: 'T' },
    });
  });

  it('never executes a denied write and lets the model reply', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'x' } })],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('Discarded.')] });
    const out = await createTurnRunner(second)(
      input(
        {
          history: paused.messages,
          userMessage: undefined,
          approvals: [
            {
              approvalId: paused.pendingApprovals[0]!.approvalId,
              approved: false,
              reason: 'Discard',
            },
          ],
        },
        t,
      ),
    );
    expect(t.create.execute).not.toHaveBeenCalled();
    expect(out.text).toBe('Discarded.');
    expect(second.doGenerateCalls).toHaveLength(1);
  });

  it('does not dispatch a step whose attempt is refused', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [text('never')] });
    const onAttempt = vi.fn(async () => {
      throw new Error('OVER_BUDGET');
    });
    await expect(createTurnRunner(model)(input({ onAttempt }))).rejects.toThrow('OVER_BUDGET');
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it('dispatches exactly one step when the second attempt is refused', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('never')],
    });
    let calls = 0;
    const onAttempt = vi.fn(async () => {
      if (calls++ === 1) throw new Error('OVER_BUDGET');
      return { settle: () => {}, release: () => {} };
    });
    await expect(createTurnRunner(model)(input({ onAttempt }, t))).rejects.toThrow('OVER_BUDGET');
    expect(model.doGenerateCalls).toHaveLength(1);
  });

  it('surfaces a model error once, without retrying', async () => {
    let n = 0;
    const model = new MockLanguageModelV3({
      doGenerate: async () => {
        n++;
        throw new Error('provider down');
      },
    });
    await expect(createTurnRunner(model)(input({}))).rejects.toThrow('provider down');
    expect(n).toBe(1);
  });

  it('stops at maxSteps model calls', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: async () => toolCall('c', 'list_notes', { boardId: 'b1' }),
    });
    const out = await createTurnRunner(model)(input({ maxSteps: 2 }, t));
    expect(model.doGenerateCalls).toHaveLength(2);
    expect(out.steps).toBe(2);
    expect(out.finishReason).toBe('tool-calls');
  });

  it('runs several read calls from one step', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [
        {
          content: [
            {
              type: 'tool-call' as const,
              toolCallId: 'c1',
              toolName: 'list_notes',
              input: JSON.stringify({ boardId: 'b1' }),
            },
            {
              type: 'tool-call' as const,
              toolCallId: 'c2',
              toolName: 'list_notes',
              input: JSON.stringify({ boardId: 'b1' }),
            },
          ],
          finishReason: { unified: 'tool-calls' as const, raw: undefined },
          usage,
          warnings: [],
        },
        text('ok'),
      ],
    });
    const out = await createTurnRunner(model)(input({}, t));
    expect(t.list.execute).toHaveBeenCalledTimes(2);
    expect(out.toolCalls.map((c) => c.toolCallId)).toEqual(['c1', 'c2']);
  });

  /**
   * What the turn service relies on when a tool stops the turn (turn.ts): the tool aborts the
   * signal and throws. The library keeps the throw as an error-text tool result and ends the
   * step; whether the runner then throws depends on whether another step is allowed.
   */
  function stoppingTool(controller: AbortController) {
    const stop = new Error('TOOL_LIMIT');
    const t = tools({
      list_notes: {
        execute: vi.fn(async () => {
          controller.abort(stop);
          throw stop;
        }),
      },
    });
    return { t, stop };
  }

  it('returns output when a tool stops the turn in the last allowed step', async () => {
    const controller = new AbortController();
    const { t } = stoppingTool(controller);
    const model = new MockLanguageModelV3({
      doGenerate: async () => toolCall('c1', 'list_notes', { boardId: 'b1' }),
    });
    const a = attempts();
    const out = await createTurnRunner(model)(
      input({ maxSteps: 1, abortSignal: controller.signal, onAttempt: a.onAttempt }, t),
    );
    expect(controller.signal.aborted).toBe(true);
    expect(out.finishReason).toBe('tool-calls');
    expect(out.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: [
        { type: 'tool-result', output: { type: 'error-text', value: 'Error: TOOL_LIMIT' } },
      ],
    });
    expect(a.seen).toHaveLength(1);
    expect(a.settled).toHaveLength(1);
  });

  it('throws the abort reason before announcing the next step', async () => {
    const controller = new AbortController();
    const { t, stop } = stoppingTool(controller);
    const model = new MockLanguageModelV3({
      doGenerate: async () => toolCall('c1', 'list_notes', { boardId: 'b1' }),
    });
    const a = attempts();
    await expect(
      createTurnRunner(model)(
        input({ maxSteps: 3, abortSignal: controller.signal, onAttempt: a.onAttempt }, t),
      ),
    ).rejects.toBe(stop);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(a.seen).toHaveLength(1);
    expect(a.settled).toHaveLength(1);
  });

  it('passes the abort signal to every model call', async () => {
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('ok')],
    });
    const controller = new AbortController();
    await createTurnRunner(model)(input({ abortSignal: controller.signal }));
    expect(model.doGenerateCalls).toHaveLength(2);
    for (const call of model.doGenerateCalls) expect(call.abortSignal).toBe(controller.signal);
  });

  it('leaves the reservation unsettled when the provider reports no usage, freeing each slot before the next step', async () => {
    const unreported = {
      inputTokens: {
        total: undefined,
        noCache: undefined,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: undefined, text: undefined, reasoning: undefined },
    };
    const model = new MockLanguageModelV3({
      doGenerate: [
        { ...toolCall('c1', 'list_notes', { boardId: 'b1' }), usage: unreported },
        { ...text('Not counted.'), usage: unreported },
      ],
    });
    const a = attempts();
    const out = await createTurnRunner(model)(input({ onAttempt: a.onAttempt }));
    expect(out.text).toBe('Not counted.');
    expect(a.seen).toHaveLength(2);
    expect(a.settled).toEqual([]);
    expect(a.log).toEqual(['reserve 0', 'release 0', 'reserve 1', 'release 1']);
    expect(out.unsettledSteps).toBe(2);
    expect(out.usage).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
    });
  });

  it('passes the provider options it was built with to every model call', async () => {
    const providerOptions = { vertex: { thinkingConfig: { thinkingLevel: 'low' } } };
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('ok')],
    });
    await createTurnRunner(model, { providerOptions })(input({}));
    expect(model.doGenerateCalls).toHaveLength(2);
    for (const call of model.doGenerateCalls) expect(call.providerOptions).toEqual(providerOptions);
    const plain = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('ok')],
    });
    await createTurnRunner(plain)(input({}));
    expect(plain.doGenerateCalls).toHaveLength(2);
    for (const call of plain.doGenerateCalls) expect(call.providerOptions).toBeUndefined();
  });

  it('sends earlier tool results elided, keeping the calls, and stores them in full', async () => {
    const marker = 'MARKER-call-Mueller';
    const t = tools({
      list_notes: {
        execute: vi.fn(async () => ({ notes: [{ id: 'n1', title: marker }], truncated: false })),
      },
    });
    const first = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('One note.')],
    });
    const earlier = await createTurnRunner(first)(input({}, t));
    expect(JSON.stringify(earlier.messages)).toContain(marker);

    const second = new MockLanguageModelV3({
      doGenerate: [toolCall('c3', 'list_notes', { boardId: 'b1' }), text('Go on.')],
    });
    const out = await createTurnRunner(second)(
      input({ history: earlier.messages, userMessage: 'And now?' }, t),
    );
    const sent = JSON.stringify(second.doGenerateCalls[0]!.prompt);
    expect(sent).not.toContain(marker);
    expect(sent).toContain(ELIDED_TOOL_RESULT);
    // The model still sees what it called, and what it answered.
    expect(second.doGenerateCalls[0]!.prompt).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        content: expect.arrayContaining([
          expect.objectContaining({ type: 'tool-call', toolCallId: 'c1', toolName: 'list_notes' }),
        ]),
      }),
    );
    expect(sent).toContain('One note.');
    // Elision is per call: the stored history keeps the result.
    expect(JSON.stringify(out.messages)).toContain(marker);
    expect(out.messages.slice(0, earlier.messages.length)).toEqual(earlier.messages);
  });

  it('describes the tools as the library sends them, JSON Schemas included', async () => {
    const t = tools();
    const definitions = JSON.parse(await toolDefinitionsJson([t.list, t.create])) as {
      name: string;
      description: string;
      inputSchema: { type: string; properties: Record<string, unknown> };
    }[];
    expect(definitions.map((d) => d.name)).toEqual(['list_notes', 'create_note']);
    expect(definitions[1]).toMatchObject({
      description: 'Create a note',
      inputSchema: { type: 'object', properties: { boardId: {}, input: {} } },
    });
  });
});
