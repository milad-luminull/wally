import type { Env } from '../../env.js';
import type { WhiteboardDoc } from '../db/types.js';

/** The effective switch: the deployment switch and the board owner's switch combined. */
export function assistantEnabledFor(
  env: Pick<Env, 'ASSISTANT_ENABLED'>,
  board: Pick<WhiteboardDoc, 'assistantDisabled'>,
): boolean {
  return env.ASSISTANT_ENABLED && board.assistantDisabled !== true;
}
