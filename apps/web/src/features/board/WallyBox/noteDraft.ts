import { NOTE_TITLE_MAX_LENGTH } from '@wally/shared';

/**
 * A note as written: the first line is its title, further lines its description. A first line
 * longer than a title may be is cut at a word, and then the whole text is the description, so
 * nothing typed is lost (the box spec, §4.2).
 */
export function noteDraftOf(text: string): { title: string; description: string } {
  const trimmed = text.trim();
  const [first = '', ...rest] = trimmed.split('\n');
  const line = first.trim();
  if (line.length <= NOTE_TITLE_MAX_LENGTH)
    return { title: line, description: rest.join('\n').trim() };
  const cut = line.slice(0, NOTE_TITLE_MAX_LENGTH + 1);
  const space = cut.lastIndexOf(' ');
  const title = (space > 0 ? cut.slice(0, space) : cut.slice(0, NOTE_TITLE_MAX_LENGTH)).trimEnd();
  return { title, description: trimmed };
}
