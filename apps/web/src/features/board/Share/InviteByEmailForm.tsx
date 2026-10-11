import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import type { MessageKey } from '@/i18n/keys';
import { whiteboardRoleValues, type WhiteboardRole } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
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
        onSuccess: () => setEmail(''),
      },
    );
  }

  return (
    /* Stacked rather than squeezed onto one line: at the popover's width an input, a role
       select and a button side by side left the email field too narrow to read a typed
       address in. */
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <Input
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('share.invite.placeholder')}
        aria-label={t('share.invite.aria')}
        aria-invalid={Boolean(error)}
        className="h-9 text-14"
      />
      <div className="flex items-center gap-2">
        <Select value={role} onValueChange={(v) => setRole(v as WhiteboardRole)}>
          <SelectTrigger
            aria-label={t('share.invite.roleAria')}
            className="h-9 flex-1 rounded-md border border-input bg-card px-3 text-14"
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
