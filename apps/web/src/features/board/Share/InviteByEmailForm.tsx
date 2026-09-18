import { useState, type FormEvent } from 'react';
import { z } from 'zod';
import { WHITEBOARD_ROLE_LABELS, whiteboardRoleValues, type WhiteboardRole } from '@wally/shared';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useCreateInvite } from '../hooks/mutations/useCreateInvite';

const emailSchema = z.string().trim().toLowerCase().email('Ungültige E-Mail-Adresse');

export function InviteByEmailForm({ boardId }: { boardId: string }) {
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
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="name@finlex.de einladen"
          aria-label="E-Mail-Adresse einladen"
          aria-invalid={Boolean(error)}
          className="h-8 flex-1 border-0 border-b border-border-subtle p-0 text-13 focus-visible:ring-0"
        />
        <Select value={role} onValueChange={(v) => setRole(v as WhiteboardRole)}>
          <SelectTrigger aria-label="Rolle" className="h-8 w-28 border-0 border-b border-border-subtle p-0 text-13">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {whiteboardRoleValues.map((r) => (
              <SelectItem key={r} value={r}>
                {WHITEBOARD_ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" variant="accent" size="sm" disabled={createInvite.isPending}>
          Einladen
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
