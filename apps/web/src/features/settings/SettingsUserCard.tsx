import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initialsOf } from '@/features/board/util/noteDerived';

/** Who is signed in. Plain text here: the menu it opens elsewhere would lead back to Settings. */
export function SettingsUserCard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  if (!user) return null;
  const name = user.displayName ?? user.email ?? t('account.menuAria');
  return (
    <div className="settings-user-card">
      <Avatar className="h-7 w-7">
        <AvatarFallback className="bg-primary text-[11px] text-primary-foreground">
          {initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      <span className="settings-user-card-text">
        <span className="settings-user-card-name">{name}</span>
        {user.displayName && user.email && (
          <span className="settings-user-card-email">{user.email}</span>
        )}
      </span>
    </div>
  );
}
