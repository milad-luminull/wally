/**
 * Scores the capture call on the sample notes in `lib/assistant/eval/captureFixtures.ts`
 * against the configured model, with no Firestore: the same seam the route uses builds each
 * call and filters each answer. Prints per-field counts, every anti-goal failure and any
 * fixture whose call failed (not scored); exits 1 when either list is not empty. It calls the
 * real model and charges the deployment's Vertex project, so the owner runs it, from the API
 * package:
 *
 *   cd apps/api
 *   ASSISTANT_VERTEX_PROJECT=luminull-wally pnpm assistant:capture-eval
 *
 * with the assistant variables from the root `.env` exported in the shell.
 *
 * Never used by tests.
 */
import { loadEnv } from './env.js';
import { acceptCapture, buildCaptureCall } from './lib/assistant/captureProposal.js';
import {
  CAPTURE_FIXTURES,
  fixtureBoard,
  fixtureContext,
  fixtureNote,
} from './lib/assistant/eval/captureFixtures.js';
import { normalizeProposal, scoreFixture, summarize } from './lib/assistant/eval/score.js';
import { createConfiguredSuggestionRunner } from './lib/assistant/model/index.js';
import { SUGGESTION_MAX_OUTPUT_TOKENS } from './lib/assistant/suggestions.js';

const env = loadEnv();
const runner = createConfiguredSuggestionRunner(env);
console.log(`model: ${env.ASSISTANT_MODEL}, ${CAPTURE_FIXTURES.length} fixtures`);

const runs = [];
/** Fixtures whose call failed (a 429, a 5xx, a timeout): reported, not scored. */
const errors: string[] = [];
for (const fixture of CAPTURE_FIXTURES) {
  const note = fixtureNote(fixture);
  const ctx = fixtureContext(fixture);
  const call = buildCaptureCall(note, fixtureBoard(fixture), ctx);
  let accepted = null;
  if (call) {
    try {
      const output = await runner({
        instructions: call.instructions,
        prompt: call.prompt,
        maxOutputTokens: SUGGESTION_MAX_OUTPUT_TOKENS,
        onAttempt: async () => ({ settle: async () => {}, release: async () => {} }),
      });
      accepted = output.fields ? acceptCapture(output.fields, call, note, ctx) : null;
    } catch (error) {
      // One provider error costs that fixture alone, not the rest of a paid run.
      errors.push(fixture.id);
      console.log(`  ${fixture.id.padEnd(28)} error: ${(error as Error).message ?? error}`);
      continue;
    }
  }
  const scores = scoreFixture(fixture, normalizeProposal(accepted));
  runs.push({ fixture, scores });
  const marks = scores.map((s) => `${s.field}:${s.outcome}`).join(' ');
  console.log(`${fixture.antiGoal ? '!' : ' '} ${fixture.id.padEnd(28)} ${marks}`);
}

const summary = summarize(runs);
console.log('\nfield         right  wrong  missed  extra');
for (const [field, c] of Object.entries(summary.byField))
  console.log(
    `${field.padEnd(12)} ${String(c.right).padStart(6)} ${String(c.wrong).padStart(6)} ${String(c.missed).padStart(7)} ${String(c.extra).padStart(6)}`,
  );
console.log(`\nright ${summary.right} of ${summary.scored} scored fields`);
console.log(
  summary.antiGoalFailures.length
    ? `anti-goal failures: ${summary.antiGoalFailures.join(', ')}`
    : 'anti-goal failures: none',
);
if (errors.length) console.log(`not scored (call failed): ${errors.join(', ')}`);
process.exit(summary.antiGoalFailures.length || errors.length ? 1 : 0);
