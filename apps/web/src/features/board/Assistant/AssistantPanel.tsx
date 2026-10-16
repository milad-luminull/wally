import { useTranslation } from 'react-i18next';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { AssistantContent } from './AssistantContent';

export function AssistantPanel({
  open,
  boardId,
  isBelowDesktop,
  onClose,
  onOpenNote,
}: {
  open: boolean;
  boardId: string;
  isBelowDesktop: boolean;
  onClose: () => void;
  onOpenNote: (noteId: string) => void;
}) {
  const { t } = useTranslation();
  // Escape closes the desktop panel unless a layer is open above it; the note panel's rule.
  useEscapeToClose(onClose, open && !isBelowDesktop);

  if (isBelowDesktop) {
    return (
      <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
        <SheetContent
          side="right"
          className="w-full max-w-sm p-0"
          hideClose
          aria-label={t('assistant.panelAria')}
          aria-describedby={undefined}
        >
          {open && (
            <AssistantContent
              boardId={boardId}
              onClose={onClose}
              onOpenNote={onOpenNote}
              autoFocus={false}
            />
          )}
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside
      role="complementary"
      aria-label={t('assistant.panelAria')}
      className="absolute inset-y-0 right-0 z-drawer flex w-[400px] max-w-full animate-slide-in-right flex-col border-l border-border bg-surface shadow-e3"
    >
      <AssistantContent boardId={boardId} onClose={onClose} onOpenNote={onOpenNote} autoFocus />
    </aside>
  );
}
