/**
 * Runs one real assistant turn from the command line, against the database DATABASE_URL
 * names and the configured model. For checking a deployment route by hand; never used by tests.
 *
 *   pnpm --filter @wally/api assistant:smoke <uid> <boardId> "<question>"
 */
import { loadEnv } from './env.js';
import { runAssistantTurn } from './lib/assistant/turn.js';
import { createConfiguredTurnRunner } from './lib/assistant/model/index.js';
import { requireAccess } from './lib/commands/context.js';
import { eq } from 'drizzle-orm';
import { liveBoard } from './lib/db/records.js';
import { createDatabase } from './lib/postgres/client.js';
import { users } from './lib/postgres/schema/index.js';

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
const { db, close } = createDatabase(env.DATABASE_URL);
try {
  const [user] = await db.select().from(users).where(eq(users.id, uid));
  if (!user) throw new Error(`No user ${uid}`);
  const board = await liveBoard(db, boardId);
  const role = requireAccess(board, uid, ['OWNER', 'EDIT', 'VIEW']);
  const conversation = await runAssistantTurn(
    { db, env, runner: createConfiguredTurnRunner(env), logger: console },
    {
      actor: { id: user.id, email: user.email, emailVerified: user.emailVerified },
      language: user.language,
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
  await close();
}
