/**
 * A line that ends in a question mark is a question for the wall, not a note
 * (0005-wallybot-inline.md §3.6, plan R1). The check is on the title line alone; the text typed
 * under it travels with the question, after a blank line.
 */
export function isQuestion(title: string): boolean {
  return title.trimEnd().endsWith('?');
}

export function questionOf(title: string, description: string): string | null {
  const line = title.trim();
  if (!isQuestion(line)) return null;
  const text = description.trim();
  return text ? `${line}\n\n${text}` : line;
}
