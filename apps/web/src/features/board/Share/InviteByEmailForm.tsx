import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { MessageKey } from '@/i18n/keys';
import { whiteboardRoleValues, type WhiteboardRole } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { useCreateInvite } from '../hooks/mutations/useCreateInvite';

/** Message is a catalogue key, resolved at render — see the note in SignInForm. */
const emailSchema = z.string().trim().toLowerCase().email('validation.email.invalid');

export function InviteByEmailForm({ boardId }: { boardId: string }) {
  const { t } = useTranslation();
  const { whiteboardRole } = useEnumLabels();
  const createInvite = useCreateInvite(boardId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WhiteboardRole>('EDIT');
  const [error, setError] = useState<MessageKey | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(
        (parsed.error.issues[0]?.message as MessageKey | undefined) ?? 'validation.email.invalid',
      );
      return;
    }
    setError(null);
    createInvite.mutate(
      { email: parsed.data, role },
      {
        onSuccess: () => {
          setEmail('');
          toast({ title: 'toast.inviteSent', values: { email: parsed.data } });
        },
        onError: () => setError('share.inviteFailed'),
      },
    );
  }

  return (
    /* One line: the role select sits inside the field's row so the email keeps the width. */
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center rounded-md border border-input bg-surface shadow-e1',
            'transition-[border-color,box-shadow] duration-150 focus-within:border-border-strong focus-within:ring-2 focus-within:ring-[color:var(--ring-alpha)]',
            error && 'border-destructive',
            '[@media(pointer:coarse)]:h-11',
          )}
        >
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('share.invite.placeholder')}
            aria-label={t('share.invite.aria')}
            aria-invalid={Boolean(error)}
            className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-13 text-fg-1 outline-none placeholder:text-fg-faint [@media(pointer:coarse)]:text-16"
          />
          <Select value={role} onValueChange={(v) => setRole(v as WhiteboardRole)}>
            <SelectTrigger
              aria-label={t('share.invite.roleAria')}
              className="h-full w-auto shrink-0 gap-1 rounded-none rounded-r-md border-0 border-l border-border-subtle bg-transparent text-12 text-fg-3 shadow-none hover:border-border-subtle focus-visible:ring-0 [@media(pointer:coarse)]:h-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {whiteboardRoleValues.map((r) => (
                <SelectItem key={r} value={r}>
                  {whiteboardRole[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="submit"
          variant="accent"
          disabled={createInvite.isPending}
          className="shrink-0"
        >
          {createInvite.isPending ? t('share.invite.pending') : t('share.invite.submit')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-12 text-status-danger">
          {t(error)}
        </p>
      )}
    </form>
  );
}
