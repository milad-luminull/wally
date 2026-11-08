import { Keyboard, LogOut, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuItem, MenuSeparator } from '@/components/ui/menu';
import { menuItemClassName } from '@/components/ui/menu-variants';
import { ThemeModeControl } from '@/components/ThemeModeControl';
import { settingsLinkState } from '@/features/settings/origin';
import { openShortcutsHelp } from '@/lib/shortcuts';
import { initialsOf } from './util/noteDerived';

/**
 * The profile menu: who is signed in, the light/dark switch (the one setting worth a
 * shortcut), the way into Settings, and Sign out. Everything else lives in Settings
 * (the settings design, "Ways in").
 */
/** `shortcuts`: off where no board's command layer is mounted to show the help. */
export function AccountMenu({
  shortcuts = true,
  showName = false,
}: { shortcuts?: boolean; showName?: boolean } = {}) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const location = useLocation();
  if (!user) return null;

  const name = user.displayName ?? user.email ?? t('account.menuAria');

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('account.menuAria')}
        /* The avatar stays 28px; the trigger around it grows to 44 on touch. */
        className={
          showName
            ? 'board-rail-profile focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]'
            : 'flex items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] focus-visible:ring-offset-2 focus-visible:ring-offset-surface [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11'
        }
      >
        <Avatar className="h-7 w-7 transition-opacity duration-150 hover:opacity-85">
          <AvatarFallback className="bg-primary text-[11px] text-primary-foreground">
            {initialsOf(name)}
          </AvatarFallback>
        </Avatar>
        {showName && <span className="board-rail-profile-name">{name}</span>}
      </PopoverTrigger>

      <PopoverContent className="max-h-[85dvh] w-64 overflow-y-auto p-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2 pt-1.5">
          {user.displayName && (
            <p className="truncate text-13 font-medium text-fg-1">{user.displayName}</p>
          )}
          <p className="truncate text-12 text-fg-3">{user.email}</p>
        </div>
        <MenuSeparator />

        <div className="flex flex-col gap-1.5 px-2 py-2">
          <p className="text-12 font-medium text-fg-3">{t('settings.appearance.mode')}</p>
          <ThemeModeControl
            label={t('settings.appearance.mode')}
            className="grid w-full grid-cols-3 [&>button]:justify-center"
          />
        </div>

        <MenuSeparator />
        <Link
          to="/settings"
          state={settingsLinkState(location)}
          className={menuItemClassName({
            className: 'focus-visible:ring-2 focus-visible:ring-ring',
          })}
        >
          <Settings strokeWidth={1.75} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{t('settings.title')}</span>
        </Link>
        {shortcuts && (
          <MenuItem icon={<Keyboard strokeWidth={1.75} />} shortcut="?" onClick={openShortcutsHelp}>
            {t('account.shortcuts')}
          </MenuItem>
        )}
        <MenuItem icon={<LogOut strokeWidth={1.75} />} onClick={() => void signOut()}>
          {t('account.signOut')}
        </MenuItem>
      </PopoverContent>
    </Popover>
  );
}
