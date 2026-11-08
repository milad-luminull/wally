import {
  INTAKE_MAX_NOTES,
  intakeItemSchema,
  type IntakeItem,
  type IntakeRequest,
  type IntakeResponse,
} from '@wally/shared';
import { listNotes } from '../commands/queries.js';
import { AppError } from '../errors.js';
import { intakeSchemaJson, type IntakeRunner, type ModelIntakeItem } from './model/index.js';
import { runMeteredCall } from './meteredCall.js';
import {
  buildIntakeInstructions,
  buildIntakePrompt,
  INTAKE_MAX_LISTED_NOTES,
} from './intakePrompt.js';
import {
  SUGGESTION_DEADLINE_MS,
  type SuggestionContext,
  type SuggestionDeps,
} from './suggestions.js';

/**
 * As long as a capture waits (SUGGESTION_DEADLINE_MS, sized to the model's slow hours): the
 * intake eval on 2026-11-08 took 5.2 s at the median, 26 s at the 95th percentile and 42 s at
 * worst, while thinking is already at the lowest level the model accepts. The box stays free
 * meanwhile; past the deadline the person's own words are kept (the box spec, §4.3). The web
 * client waits AI_REQUEST_TIMEOUT_MS (55 s) for it.
 */
export const INTAKE_DEADLINE_MS = SUGGESTION_DEADLINE_MS;
/** Room for ten notes in the writer's words and one question back. */
export const INTAKE_MAX_OUTPUT_TOKENS = 1024;

export interface IntakeDeps extends SuggestionDeps {
  runner: IntakeRunner;
}

/** The item as the contract has it, or null when it does not fit (an empty text, a bad id). */
function toItem(
  raw: ModelIntakeItem,
  message: string,
  noteTitles: Map<string, string>,
): IntakeItem | null {
  const text = raw.text.trim();
  const candidate = (): unknown => {
    switch (raw.kind) {
      case 'note':
      case 'ask':
        return { kind: raw.kind, text };
      case 'duplicate': {
        const title = noteTitles.get(raw.noteId);
        // A note the board does not hold is no duplicate: the words are a note of their own.
        return title === undefined
          ? { kind: 'note', text }
          : { kind: 'duplicate', text, note: { id: raw.noteId, title } };
      }
      case 'clarify': {
        const parsed = intakeItemSchema.safeParse({
          kind: 'clarify',
          question: raw.question.trim(),
          options: raw.options.map((o) => ({ ...o, label: o.label.trim(), text: o.text.trim() })),
        });
        // A question back with fewer than two ways on is no question: the message is asked.
        return parsed.success ? parsed.data : { kind: 'ask', text: message };
      }
    }
  };
  const parsed = intakeItemSchema.safeParse(candidate());
  return parsed.success ? parsed.data : null;
}

/**
 * The model's items as the box takes them: in order, at most `INTAKE_MAX_NOTES` notes (the rest
 * marked `truncated`), at most one item that is not a note (the box shows one reply), a duplicate
 * only of a note on the board. Null when nothing is left.
 */
export function acceptIntake(
  items: ModelIntakeItem[],
  message: string,
  noteTitles: Map<string, string>,
): IntakeResponse | null {
  const accepted: IntakeItem[] = [];
  let notes = 0;
  let other = false;
  let truncated = false;
  for (const raw of items) {
    const item = toItem(raw, message, noteTitles);
    if (!item) continue;
    if (item.kind === 'note') {
      if (notes === INTAKE_MAX_NOTES) {
        truncated = true;
        continue;
      }
      notes++;
    } else {
      if (other) continue;
      other = true;
    }
    accepted.push(item);
  }
  return accepted.length > 0 ? { items: accepted, truncated } : null;
}

/**
 * One intake (the box spec, §4.1): read the open notes the caller can see, ask the model once
 * (reserve, call, settle) what the message holds, and keep what fits. Read-only: the box writes
 * the notes itself. Throws BudgetError and AppError only.
 */
export async function runIntake(
  deps: IntakeDeps,
  ctx: SuggestionContext,
  request: IntakeRequest,
): Promise<IntakeResponse> {
  const { actor, board } = ctx;
  const open = await listNotes(deps.db, actor, board.id, { status: 'OPEN' });
  const notes = open
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .slice(0, INTAKE_MAX_LISTED_NOTES)
    .map((note) => ({ id: note.id, title: note.title }));
  const { output, startedAt } = await runMeteredCall(deps, {
    actorId: actor.id,
    boardId: board.id,
    instructions: buildIntakeInstructions({
      today: request.today,
      timeZone: request.timeZone,
      language: ctx.language,
    }),
    prompt: buildIntakePrompt({ message: request.message, context: request.context, notes }),
    schema: await intakeSchemaJson(),
    maxOutputTokens: INTAKE_MAX_OUTPUT_TOKENS,
    deadlineMs: deps.deadlineMs ?? INTAKE_DEADLINE_MS,
    run: (input) => deps.runner(input),
  });
  const accepted = output.items
    ? acceptIntake(output.items, request.message, new Map(notes.map((n) => [n.id, n.title])))
    : null;
  const kinds = { note: 0, ask: 0, duplicate: 0, clarify: 0 };
  for (const item of accepted?.items ?? []) kinds[item.kind]++;
  // Counts only: what was typed never reaches the log.
  deps.logger?.info({
    type: 'assistant.intake',
    boardId: board.id,
    kinds,
    truncated: accepted?.truncated ?? false,
    usage: output.usage,
    ms: Date.now() - startedAt,
  });
  if (!accepted) throw new AppError(502, 'ASSISTANT_NO_ANSWER', 'The model gave no usable answer');
  return accepted;
}
