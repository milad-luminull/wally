/** `[note:ID]` as the instructions ask the model to write it. */
export const NOTE_MARKER = /\[note:([^\]\s]+)\]/g;

/**
 * Valid markers become the note's title in the text and one chip each; a marker for a note
 * the caller cannot currently see is removed (RFC-0003-wally-agent.md §3.2 "Chips are what the
 * caller may see").
 */
export function resolveChips(
  text: string,
  visible: Map<string, string>,
): { text: string; chips: { id: string; title: string }[] } {
  const chips = new Map<string, string>();
  const replaced = text.replace(NOTE_MARKER, (_match, id: string) => {
    const title = visible.get(id);
    if (title === undefined) return '';
    chips.set(id, title);
    return title;
  });
  return {
    text: replaced
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ ([.,;:!?])/g, '$1')
      .trim(),
    chips: [...chips].map(([id, title]) => ({ id, title })),
  };
}
