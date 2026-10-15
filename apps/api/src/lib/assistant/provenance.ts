/**
 * Trusted execution context for a write the assistant made. The server supplies it; it is
 * never read from a model-controlled argument (WALLY_AGENT.md §3.3). The command layer
 * stores it on the receipt, folds it into the idempotency fingerprint, marks note history
 * with `via`, and writes one contents-free audit record per committed command.
 */
export interface Provenance {
  via: 'assistant';
  conversationId: string;
  approvalId: string;
}

/** Audit records expire through a Firestore TTL policy on `expiresAt`, like receipts. */
export const ASSISTANT_AUDIT_RETENTION_DAYS = 30;
