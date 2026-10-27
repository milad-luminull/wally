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

/**
 * Returned by `onAttempt`. Ends once: settled with the step's actual usage, or released when
 * the usage will not be known (the call failed, was aborted or reported none), which frees the
 * slot and keeps the reservation charged.
 */
export interface AttemptLease {
  settle: (usage: TurnUsage) => Promise<void> | void;
  release: () => Promise<void> | void;
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
  /** The steps whose usage was reported, summed. */
  usage: TurnUsage;
  /** Steps whose usage the provider did not report: their reservations stay charged. */
  unsettledSteps: number;
  steps: number;
  finishReason: TurnFinishReason;
  /** The full history to store: the input history plus everything this turn produced. */
  messages: StoredMessage[];
}

export type TurnRunner = (input: TurnInput) => Promise<TurnOutput>;

/** One structured call for a capture (RFC-0005-wallybot-inline.md §4: one model call, strict JSON). */
export interface SuggestionInput {
  instructions: string;
  prompt: string;
  /** The answer's allowance. The runner adds the configured model's thinking room on top. */
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
  /**
   * Called once before the call. Throwing means the call is not dispatched. `info.maxOutputTokens`
   * is everything the call may produce and be billed for, thinking included: reserve that.
   */
  onAttempt: (info: AttemptInfo) => Promise<AttemptLease>;
}
export interface ModelSuggestion {
  dueDate: { value: string; confidence: number; reason: string } | null;
  priority: { value: 'HOCH' | 'NIEDRIG'; confidence: number; reason: string } | null;
  assignee: { memberId: string; confidence: number; reason: string } | null;
  title: { value: string; confidence: number; reason: string } | null;
  subtasks: { items: string[]; confidence: number; reason: string } | null;
  links: { items: { noteId: string; reason: string }[]; confidence: number; reason: string } | null;
  horizon: { value: 'DIESE_WOCHE' | 'SPAETER'; confidence: number; reason: string } | null;
  visibility: { value: 'PRIVATE'; confidence: number; reason: string } | null;
  tags: { items: string[]; confidence: number; reason: string } | null;
  properties: {
    items: { key: string; value: string }[];
    confidence: number;
    reason: string;
  } | null;
  description: { value: string; confidence: number; reason: string } | null;
}
export interface SuggestionOutput {
  /** null when the model produced nothing that validates against the schema. */
  fields: ModelSuggestion | null;
  usage: TurnUsage | null;
  finishReason: TurnFinishReason;
}
export type SuggestionRunner = (input: SuggestionInput) => Promise<SuggestionOutput>;

/** One structured call for a Tidy of the horizon wall (RFC-0005-wallybot-inline.md §3.5, plan R3). */
export interface TidyInput {
  instructions: string;
  prompt: string;
  /** The answer's allowance. The runner adds the configured model's thinking room on top. */
  maxOutputTokens: number;
  abortSignal?: AbortSignal;
  onAttempt: (info: AttemptInfo) => Promise<AttemptLease>;
}
export interface ModelTidy {
  moves: {
    noteId: string;
    /** Only away from Today: a note the words leave for today needs no move. */
    horizon: 'DIESE_WOCHE' | 'SPAETER';
    confidence: number;
    reason: string;
  }[];
}
export interface TidyOutput {
  /** null when the model produced nothing that validates against the schema. */
  moves: ModelTidy | null;
  usage: TurnUsage | null;
  finishReason: TurnFinishReason;
}
export type TidyRunner = (input: TidyInput) => Promise<TidyOutput>;
