import type { z } from 'zod';

/** `provider:model`, the only way a model is named outside the boundary (spec §3.5). */
export interface ModelRef {
  provider: 'vertex' | 'vertex-anthropic';
  model: string;
}

/** One assistant operation as the model sees it. */
export interface TurnTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  /** A write: the turn pauses and returns a pending approval instead of executing. */
  needsApproval: boolean;
  execute: (input: unknown) => Promise<unknown>;
}

/** The library's own message objects, stored as JSON on the conversation and never read by Wally. */
export type StoredMessage = unknown;

export interface ApprovalDecision {
  approvalId: string;
  approved: boolean;
  reason?: string;
}

export interface TurnUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

/** What a ledger learns before a model step is dispatched. */
export interface AttemptInfo {
  stepNumber: number;
  messageCount: number;
  maxOutputTokens: number;
}

/** Returned by `onAttempt`; settled once with the step's actual usage. */
export interface AttemptLease {
  settle: (usage: TurnUsage) => Promise<void> | void;
}

export interface TurnInput {
  instructions: string;
  history: StoredMessage[];
  /**
   * Appended as the user's message when present. A turn carries either a user message or
   * approval decisions, never both; the runner rejects the combination before any attempt.
   */
  userMessage?: string;
  /**
   * Answers to pending approvals from the previous turn, appended before the model runs.
   * Only on a continuation without `userMessage`; the runner rejects a turn with both.
   */
  approvals?: ApprovalDecision[];
  tools: TurnTool[];
  maxOutputTokens: number;
  /** Model steps per turn; a step is one model call. */
  maxSteps: number;
  abortSignal?: AbortSignal;
  /** Called before every model step. Throwing means the step is not dispatched. */
  onAttempt: (info: AttemptInfo) => Promise<AttemptLease>;
}

export interface PendingApproval {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  reason?: string;
}

export interface ToolCallRecord {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
}

export type TurnFinishReason =
  'stop' | 'length' | 'content-filter' | 'tool-calls' | 'error' | 'other';

export interface TurnOutput {
  text: string;
  pendingApprovals: PendingApproval[];
  toolCalls: ToolCallRecord[];
  usage: TurnUsage;
  steps: number;
  finishReason: TurnFinishReason;
  /** The full history to store: the input history plus everything this turn produced. */
  messages: StoredMessage[];
}

export type TurnRunner = (input: TurnInput) => Promise<TurnOutput>;
