/** How long the cards an answer is about wear the ring, so the eye finds them on the wall. */
export const FLASH_MS = 1600;

/**
 * Marks the notes' cards with `data-flash` for a moment (the box spec, §5.2). A card that is not
 * drawn (another view, filtered out) is skipped; nothing scrolls or moves.
 */
export function flashNotes(ids: string[]): void {
  for (const id of ids) {
    for (const card of document.querySelectorAll<HTMLElement>(
      `[data-note-id="${CSS.escape(id)}"]`,
    )) {
      card.setAttribute('data-flash', '');
      setTimeout(() => card.removeAttribute('data-flash'), FLASH_MS);
    }
  }
}
