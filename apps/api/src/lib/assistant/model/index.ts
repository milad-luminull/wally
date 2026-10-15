/**
 * The model boundary (ADR-0013). Everything outside src/lib/assistant/model/ imports from
 * here and sees only Wally's own types; the library is an implementation detail.
 */
export { createConfiguredTurnRunner } from './runTurn.js';
export { parseModelRef } from './config.js';
export type {
  ApprovalDecision,
  AttemptInfo,
  AttemptLease,
  ModelRef,
  PendingApproval,
  StoredMessage,
  ToolCallRecord,
  TurnFinishReason,
  TurnInput,
  TurnOutput,
  TurnRunner,
  TurnTool,
  TurnUsage,
} from './types.js';
