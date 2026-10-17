/**
 * The model boundary (ADR-0013). Everything outside src/lib/assistant/model/ imports from
 * here and sees only Wally's own types; the library is an implementation detail.
 */
export { createConfiguredTurnRunner, toolDefinitionsJson } from './runTurn.js';
export { createConfiguredSuggestionRunner } from './suggest.js';
export { parseModelRef } from './config.js';
export type {
  ApprovalDecision,
  AttemptInfo,
  AttemptLease,
  ModelRef,
  ModelSuggestion,
  PendingApproval,
  StoredMessage,
  SuggestionInput,
  SuggestionOutput,
  SuggestionRunner,
  ToolCallRecord,
  TurnFinishReason,
  TurnInput,
  TurnOutput,
  TurnRunner,
  TurnTool,
  TurnUsage,
} from './types.js';
