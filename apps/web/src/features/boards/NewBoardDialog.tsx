import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { BOARD_NAME_MAX_LENGTH, INITIAL_BOARD_NAME, MAX_OWN_BOARDS } from '@wally/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FALLBACK_LOCALE, normalizeLocale } from '@/i18n/locales';
import { useCreateBoard } from '@/features/board/hooks/mutations/useCreateBoard';

/**
 * One field, prefilled with the localized initial name so Enter alone creates a board
 * (RFC-0002 §8). On success the app goes straight into the new, empty board.
 */
export function NewBoardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateBoard();
  const initialName = INITIAL_BOARD_NAME[normalizeLocale(i18n.language) ?? FALLBACK_LOCALE];
  const [name, setName] = useState(initialName);
  const { reset } = create;

  // Every opening starts fresh: the prefilled name, no error from a previous attempt.
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    reset();
  }, [open, initialName, reset]);

  const trimmed = name.trim();
  const error = create.error
    ? create.error.code === 'BOARD_LIMIT_REACHED'
      ? t('home.create.limitReached', { max: MAX_OWN_BOARDS })
      : t('home.create.failed')
    : null;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || create.isPending) return;
    create.mutate(
      { name: trimmed },
      {
        onSuccess: (board) => {
          onOpenChange(false);
          navigate(`/boards/${board.id}`);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !create.isPending && onOpenChange(next)}>
      {/* The field's label is the whole story; there is no separate description. */}
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <form onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{t('home.create.title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-board-name">{t('home.create.nameLabel')}</Label>
            <Input
              id="new-board-name"
              value={name}
              maxLength={BOARD_NAME_MAX_LENGTH}
              autoFocus
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'new-board-error' : undefined}
            />
            <p
              id="new-board-error"
              role="alert"
              className="min-h-[1.25rem] text-12 text-status-danger"
            >
              {error}
            </p>
          </div>
          <DialogFooter className="mt-3">
            <Button
              type="button"
              variant="ghost"
              disabled={create.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!trimmed || create.isPending}>
              {t('home.create.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
