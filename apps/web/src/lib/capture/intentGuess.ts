export type Intent = 'note' | 'ask';

/**
 * Words a question or a lookup starts with, in English and German. German stays here because
 * people write German too; this is a parser word list (the English-code rule's exception).
 */
const ASK_STARTERS = new Set(
  (
    'what whats why how when who which where is are do does did can could should will ' +
    'show find list summarize summarise ' +
    'was warum wieso weshalb wie wann wer welche welcher welches wo ist sind gibt kann ' +
    'zeig zeige finde liste'
  ).split(' '),
);

/** Task verbs: a note that starts with one stays a note, even with a question mark. */
const TASK_STARTERS = new Set(
  'ask call email mail buy book send check frag frage ruf rufe schreib schreibe kauf kaufe buche schick schicke'.split(
    ' ',
  ),
);

const firstWord = (text: string) =>
  (text.toLowerCase().match(/^[\p{L}']+/u)?.[0] ?? '').replace(/'/g, '');

/**
 * A guess, without the network, of what Enter will do, so the box can say so before it is
 * pressed (the box spec, §4.2). Only a hint: the intake decides, unless Tab pinned the hint.
 */
export function guessIntent(text: string): Intent {
  const trimmed = text.trim();
  if (!trimmed) return 'note';
  const word = firstWord(trimmed);
  if (TASK_STARTERS.has(word)) return 'note';
  if (ASK_STARTERS.has(word)) return 'ask';
  return trimmed.endsWith('?') ? 'ask' : 'note';
}
