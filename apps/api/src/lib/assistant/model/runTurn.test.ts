import { describe, expect, it, vi } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { z } from 'zod';
import { createTurnRunner } from './runTurn.js';
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
  const onAttempt = vi.fn(async (info: AttemptInfo) => {
    seen.push(info);
    return { settle: (u: TurnUsage) => void settled.push(u) };
  });
  return { onAttempt, seen, settled };
}

function input(partial: Partial<TurnInput>, t = tools()): TurnInput {
  return {
    instructions: 'You are Wally.',
    history: [],
    userMessage: 'Was ist heute offen?',
    tools: [t.list, t.create],
    maxOutputTokens: 256,
    maxSteps: 4,
    onAttempt: attempts().onAttempt,
    ...partial,
  };
}

describe('createTurnRunner', () => {
  it('returns the text of a plain reply and settles one attempt', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [text('Nichts offen.')] });
    const a = attempts();
    const out = await createTurnRunner(model)(input({ onAttempt: a.onAttempt }));
    expect(out.text).toBe('Nichts offen.');
    expect(out.finishReason).toBe('stop');
    expect(out.steps).toBe(1);
    expect(out.pendingApprovals).toEqual([]);
    expect(a.seen).toEqual([{ stepNumber: 0, messageCount: 1, maxOutputTokens: 256 }]);
    expect(a.settled).toEqual([
      { inputTokens: 10, cachedInputTokens: 2, outputTokens: 5, reasoningTokens: 1 },
    ]);
    expect(out.usage).toEqual({
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      reasoningTokens: 1,
    });
    expect(out.messages.length).toBeGreaterThan(1);
  });

  it('executes a read tool and continues to the answer, one attempt per step', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [toolCall('c1', 'list_notes', { boardId: 'b1' }), text('Drei Notizen.')],
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
    expect(out.text).toBe('Drei Notizen.');
    expect(out.steps).toBe(2);
    expect(a.seen.map((s) => s.stepNumber)).toEqual([0, 1]);
    expect(a.settled).toHaveLength(2);
    expect(out.usage.inputTokens).toBe(20);
  });

  it('pauses a write tool as a pending approval and never executes it', async () => {
    const t = tools();
    const model = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Müller anrufen' } }),
      ],
    });
    const out = await createTurnRunner(model)(input({}, t));
    expect(t.create.execute).not.toHaveBeenCalled();
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(out.pendingApprovals).toHaveLength(1);
    expect(out.pendingApprovals[0]).toMatchObject({
      toolCallId: 'c2',
      toolName: 'create_note',
      input: { boardId: 'b1', input: { title: 'Müller anrufen' } },
    });
    expect(out.pendingApprovals[0]!.approvalId).toEqual(expect.any(String));
    expect(out.finishReason).toBe('tool-calls');
  });

  it('executes the write on the continuation that approves it', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [
        toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'Müller anrufen' } }),
      ],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('Erledigt.')] });
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
      input: { title: 'Müller anrufen' },
    });
    expect(out.toolCalls[0]).toMatchObject({
      toolName: 'create_note',
      output: { id: 'n1', revision: 1 },
    });
    expect(out.text).toBe('Erledigt.');
    expect(out.pendingApprovals).toEqual([]);
  });

  it('never executes a denied write and lets the model reply', async () => {
    const t = tools();
    const first = new MockLanguageModelV3({
      doGenerate: [toolCall('c2', 'create_note', { boardId: 'b1', input: { title: 'x' } })],
    });
    const paused = await createTurnRunner(first)(input({}, t));
    const second = new MockLanguageModelV3({ doGenerate: [text('Verworfen.')] });
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
    expect(out.text).toBe('Verworfen.');
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
      return { settle: () => {} };
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

  it('passes the abort signal to the model call', async () => {
    const model = new MockLanguageModelV3({ doGenerate: [text('ok')] });
    const controller = new AbortController();
    await createTurnRunner(model)(input({ abortSignal: controller.signal }));
    expect(model.doGenerateCalls[0]!.abortSignal).toBe(controller.signal);
  });
});
