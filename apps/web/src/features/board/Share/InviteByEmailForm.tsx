import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { whiteboardRoleValues, type WhiteboardRole } from '@wally/shared';
import { useEnumLabels } from '@/i18n/enumLabels';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useCreateInvite } from '../hooks/mutations/useCreateInvite';

const emailSchema = z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse');

export function InviteByEmailForm({ boardId }: { boardId: string }) {
  const { whiteboardRole } = useEnumLabels();
  const createInvite = useCreateInvite(boardId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WhiteboardRole>('EDIT');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Ungültige E-Mail-Adresse');
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
        placeholder="name@finlex.de"
        aria-label="E-Mail-Adresse einladen"
        aria-invalid={Boolean(error)}
        className="h-9 text-13"
      />
      <div className="flex items-center gap-2">
        <Select value={role} onValueChange={(v) => setRole(v as WhiteboardRole)}>
          <SelectTrigger aria-label="Rolle" className="h-9 flex-1 rounded-md border border-input bg-card px-3 text-13">
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
        <Button type="submit" variant="accent" disabled={createInvite.isPending} className="shrink-0">
          {createInvite.isPending ? 'Lädt ein…' : 'Einladen'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-12 text-status-danger">
          {error}
        </p>
      )}
    </form>
  );
}
