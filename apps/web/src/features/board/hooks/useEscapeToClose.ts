import { useEffect } from 'react';

/**
 * Escape closes a desktop side panel (the note panel and the question panel).
 *
 * The mobile sheet gets this free from Radix; the desktop `<aside>` is a plain element, so
 * until now the panel had exactly one exit — a 28px X in the corner. That is half of why
 * people reached for the footer button instead.
 *
 * It defers to any layer above it: Radix renders selects and popovers into a popper wrapper
 * and the delete confirmation as an alertdialog, and each closes itself on Escape. Without
 * this guard, dismissing the assignee dropdown — or backing out of the delete dialog — would
 * take the whole panel with it.
 */
export function useEscapeToClose(onClose: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const layerAbove = document.querySelector(
        '[data-radix-popper-content-wrapper], [role="alertdialog"], [role="dialog"]',
      );
      if (layerAbove) return;
      onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [enabled, onClose]);
}
