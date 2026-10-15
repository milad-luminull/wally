/**
 * Runs one real assistant turn from the command line, against whatever Firestore the
 * environment points at (the emulator when FIRESTORE_EMULATOR_HOST is set) and the
 * configured model. For checking a deployment route by hand; never used by tests.
 *
 *   pnpm --filter @wally/api assistant:smoke <uid> <boardId> "<question>"
 */
import { loadEnv } from './env.js';
import { runAssistantTurn } from './lib/assistant/turn.js';
import { createConfiguredTurnRunner } from './lib/assistant/model/index.js';
import { requireAccess } from './lib/commands/context.js';
import { getDb } from './lib/db/client.js';
import {
  liveWhiteboard,
  userLanguage,
  usersCol,
  whiteboardsCol,
  withId,
} from './lib/db/collections.js';

const [uid, boardId, ...rest] = process.argv.slice(2);
const question = rest.join(' ');
if (!uid || !boardId || !question) {
  console.error('usage: assistant:smoke <uid> <boardId> "<question>"');
  process.exit(2);
}
const env = loadEnv();
console.log(
  "note: this script bypasses the deployment switch and the board owner's switch, and charges the deployment key.",
);

/** The calendar date in `timeZone` as YYYY-MM-DD: the date the user sees, not UTC's. */
function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: 'year' | 'month' | 'day') => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
// getDb, like the maintenance script: it honours FIRESTORE_DATABASE_ID and the configured
// credentials, so the same command reads the emulator locally and the named database elsewhere.
const db = getDb();
try {
  const user = withId(await usersCol(db).doc(uid).get());
  if (!user) throw new Error(`No user ${uid}`);
  const board = liveWhiteboard(await whiteboardsCol(db).doc(boardId).get());
  const role = requireAccess(board, uid, ['OWNER', 'EDIT', 'VIEW']);
  const conversation = await runAssistantTurn(
    { db, env, runner: createConfiguredTurnRunner(env), logger: console },
    {
      actor: { id: user.id, email: user.email, emailVerified: user.emailVerified },
      language: userLanguage(user),
      board: board!,
      role,
      request: {
        message: question,
        timeZone,
        today: localDate(new Date(), timeZone),
      },
    },
  );
  const reply = conversation.entries.at(-1)!;
  console.log(reply.text);
  if (reply.chips.length)
    console.log('notes:', reply.chips.map((c) => `${c.title} (${c.id})`).join(', '));
  if (reply.stopped) console.log('stopped:', reply.stopped);
  console.log('conversation:', conversation.id);
} finally {
  await db.terminate();
}
