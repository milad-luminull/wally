import { LogOut } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';

export function SettingsSignOut() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  return (
    <div className="board-rail-nav settings-signout">
      <button type="button" onClick={() => void signOut()}>
        <LogOut size={15} strokeWidth={1.8} aria-hidden />
        <span>{t('account.signOut')}</span>
      </button>
    </div>
  );
}
