import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Segmented } from './ui/segmented';
import { useTheme } from '@/lib/themeContext';

/** System, Light or Dark. Lives on the landing page, in the profile menu and in Settings. */
export function ThemeModeControl({ label, className }: { label?: string; className?: string }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  return (
    <Segmented
      aria-label={label ?? t('account.theme.label')}
      value={theme}
      onChange={setTheme}
      className={className}
      options={[
        {
          value: 'system',
          label: t('account.theme.system'),
          icon: <Monitor aria-hidden size={14} />,
        },
        { value: 'light', label: t('account.theme.light'), icon: <Sun aria-hidden size={14} /> },
        { value: 'dark', label: t('account.theme.dark'), icon: <Moon aria-hidden size={14} /> },
      ]}
    />
  );
}
