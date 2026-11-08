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
 * with the assistant variables from the root `.env` exported in the shell.
 *
 * Never used by tests.
 */
import { loadEnv } from './env.js';
import { acceptIntake, INTAKE_MAX_OUTPUT_TOKENS } from './lib/assistant/intake.js';
import { buildIntakeInstructions, buildIntakePrompt } from './lib/assistant/intakePrompt.js';
import { INTAKE_FIXTURES, scoreIntakeFixture } from './lib/assistant/eval/intakeFixtures.js';
import { createConfiguredIntakeRunner } from './lib/assistant/model/index.js';

/** The bar the plan sets: 21 of 24. */
const PASS_RATIO = 21 / 24;

const env = loadEnv();
const runner = createConfiguredIntakeRunner(env);
console.log(`model: ${env.ASSISTANT_MODEL}, ${INTAKE_FIXTURES.length} fixtures`);

let right = 0;
const errors: string[] = [];
for (const fixture of INTAKE_FIXTURES) {
  const notes = fixture.board ?? [];
  const language = fixture.id.startsWith('de-') ? 'de' : 'en';
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
    const answer = output.items
      ? acceptIntake(output.items, fixture.message, new Map(notes.map((n) => [n.id, n.title])))
      : null;
    const ok = scoreIntakeFixture(fixture, answer);
    if (ok) right++;
    const got = answer ? answer.items.map((item) => item.kind).join(', ') : 'nothing';
    console.log(
      `${ok ? ' ' : '✗'} ${fixture.id.padEnd(28)} ${ok ? got : `expected ${fixture.expect.join(', ')}, got ${got}`}`,
    );
  } catch (error) {
    // One provider error costs that fixture alone, not the rest of a paid run.
    errors.push(fixture.id);
    console.log(`  ${fixture.id.padEnd(28)} error: ${(error as Error).message ?? error}`);
  }
}

console.log(`\nright ${right} of ${INTAKE_FIXTURES.length}`);
if (errors.length) console.log(`not scored (call failed): ${errors.join(', ')}`);
process.exit(right < INTAKE_FIXTURES.length * PASS_RATIO || errors.length ? 1 : 0);
