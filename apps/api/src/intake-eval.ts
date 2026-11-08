/**
 * Scores the Wally box's intake call on the sample messages in
 * `lib/assistant/eval/intakeFixtures.ts` against the configured model, with no database: the
 * same prompt builders and the same `acceptIntake` the route uses. Prints each mismatch and the
 * score; exits 1 below 21 of 24 or when a call failed. It calls the real model and charges the
 * deployment's Vertex project, so the owner runs it, from the API package:
 *
 *   cd apps/api
 *   ASSISTANT_VERTEX_PROJECT=luminull-wally-prod pnpm assistant:intake-eval
 *
 * It reads only the model's settings (`loadModelEnv`): no database is needed.
 *
 * Never used by tests.
 */
import { loadModelEnv } from './env.js';
import {
  acceptIntake,
  INTAKE_DEADLINE_MS,
  INTAKE_MAX_OUTPUT_TOKENS,
} from './lib/assistant/intake.js';
import { buildIntakeInstructions, buildIntakePrompt } from './lib/assistant/intakePrompt.js';
import { INTAKE_FIXTURES, scoreIntakeFixture } from './lib/assistant/eval/intakeFixtures.js';
import { createConfiguredIntakeRunner } from './lib/assistant/model/index.js';

/** The bar the plan sets: 21 of 24. */
const PASS_RATIO = 21 / 24;

const env = loadModelEnv();
const runner = createConfiguredIntakeRunner(env);
console.log(`model: ${env.ASSISTANT_MODEL}, ${INTAKE_FIXTURES.length} fixtures`);

let right = 0;
const errors: string[] = [];
/** Each call's time, to set INTAKE_DEADLINE_MS from what the model takes. */
const times: number[] = [];
for (const fixture of INTAKE_FIXTURES) {
  const notes = fixture.board ?? [];
  const language = fixture.id.startsWith('de-') ? 'de' : 'en';
  const started = Date.now();
  try {
    const output = await runner({
      instructions: buildIntakeInstructions({
        today: '2026-11-08',
        timeZone: 'Europe/Berlin',
        language,
      }),
      prompt: buildIntakePrompt({ message: fixture.message, context: fixture.context, notes }),
      maxOutputTokens: INTAKE_MAX_OUTPUT_TOKENS,
      onAttempt: async () => ({ settle: async () => {}, release: async () => {} }),
    });
    times.push(Date.now() - started);
    const answer = output.items
      ? acceptIntake(output.items, fixture.message, new Map(notes.map((n) => [n.id, n.title])))
      : null;
    const ok = scoreIntakeFixture(fixture, answer);
    if (ok) right++;
    const got = answer ? answer.items.map((item) => item.kind).join(', ') : 'nothing';
    console.log(
      `${ok ? ' ' : '✗'} ${fixture.id.padEnd(28)} ${String(times.at(-1)).padStart(6)} ms  ${ok ? got : `expected ${fixture.expect.join(', ')}, got ${got}`}`,
    );
  } catch (error) {
    // One provider error costs that fixture alone, not the rest of a paid run.
    errors.push(fixture.id);
    console.log(`  ${fixture.id.padEnd(28)} error: ${(error as Error).message ?? error}`);
  }
}

console.log(`\nright ${right} of ${INTAKE_FIXTURES.length}`);
const sorted = [...times].sort((a, b) => a - b);
const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
if (sorted.length)
  console.log(
    `time: median ${at(0.5)} ms, 95th percentile ${at(0.95)} ms, slowest ${sorted.at(-1)} ms (deadline ${INTAKE_DEADLINE_MS} ms)`,
  );
if (errors.length) console.log(`not scored (call failed): ${errors.join(', ')}`);
process.exit(right < INTAKE_FIXTURES.length * PASS_RATIO || errors.length ? 1 : 0);
