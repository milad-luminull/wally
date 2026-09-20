import { LogOut } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { initialsOf } from './util/noteDerived';

/**
 * The account affordance the chrome was missing: `AuthProvider` has exposed `signOut`
 * since the first build, but nothing in the UI ever called it, so a signed-in user had no
 * way out of the app.
 */
export function AccountMenu() {
  const { user, signOut } = useAuth();
  if (!user) return null;

  const name = user.displayName ?? user.email ?? 'Konto';

  return (
    <Popover>
      <PopoverTrigger
        aria-label="Konto"
        /* The avatar stays 32px; the trigger around it grows to 44 on touch. */
        className="flex items-center justify-center rounded-full transition-transform duration-150 ease-ds hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface-alt motion-reduce:hover:translate-y-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <Avatar className="h-8 w-8 ring-2 ring-border-subtle">
          <AvatarFallback className="bg-[color:var(--petrol-dark)] text-11">{initialsOf(name)}</AvatarFallback>
        </Avatar>
      </PopoverTrigger>

      <PopoverContent className="w-64 p-0">
        <div className="flex flex-col gap-0.5 border-b border-border-subtle px-4 py-3">
          {user.displayName && <p className="truncate text-13 font-semibold text-fg-1">{user.displayName}</p>}
          <p className="truncate text-12 text-fg-muted">{user.email}</p>
        </div>
        <div className="p-1.5">
          <button
            type="button"
            onClick={() => void signOut()}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-13 font-medium text-fg-2 transition-colors duration-150 hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
          >
            <LogOut className="h-4 w-4 text-fg-muted" strokeWidth={1.9} />
            Abmelden
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
