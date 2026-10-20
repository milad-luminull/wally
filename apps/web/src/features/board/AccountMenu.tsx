import { Grid3x3, Grip, Keyboard, LogOut, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/i18n/LanguageProvider';
import { SUPPORTED_LOCALES, type AppLocale } from '@/i18n/locales';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuItem, MenuSeparator } from '@/components/ui/menu';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import { AppearanceControls } from '@/components/AppearanceControls';
import { useCanvasPattern, useWallybotPreferences } from '@/lib/preferences';
import { openShortcutsHelp } from '@/lib/shortcuts';
import { initialsOf } from './util/noteDerived';

/**
 * The account affordance the chrome was missing: `AuthProvider` has exposed `signOut`
 * since the first build, but nothing in the UI ever called it, so a signed-in user had no
 * way out of the app.
 */
/**
 * Endonyms — each language named in itself — and never translated: someone who lands in a
 * language they cannot read has to be able to find their own in this list.
 */
const LANGUAGE_ENDONYMS: Record<AppLocale, string> = {
  de: 'Deutsch',
  en: 'English',
};

/** `shortcuts`: off where no board's command layer is mounted to show the help. */
export function AccountMenu({
  shortcuts = true,
  showName = false,
}: { shortcuts?: boolean; showName?: boolean } = {}) {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { language, setLanguage, isSaving, saveFailed } = useLanguage();
  const [canvasPattern, setCanvasPattern] = useCanvasPattern();
  const [wallybot, setWallybot] = useWallybotPreferences();
  if (!user) return null;
  const onShowShortcuts = openShortcutsHelp;

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

      <PopoverContent className="max-h-[85dvh] w-72 overflow-y-auto p-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2 pt-1.5">
          {user.displayName && (
            <p className="truncate text-13 font-medium text-fg-1">{user.displayName}</p>
          )}
          <p className="truncate text-12 text-fg-3">{user.email}</p>
        </div>
        <MenuSeparator />

        <div className="px-2 py-2">
          <AppearanceControls />
        </div>

        <div className="flex flex-col gap-1.5 px-2 pb-2 pt-1">
          <p className="text-12 font-medium text-fg-3">{t('account.canvas.label')}</p>
          <Segmented
            aria-label={t('account.canvas.label')}
            value={canvasPattern}
            onChange={setCanvasPattern}
            className="grid w-full grid-cols-3 [&>button]:justify-center"
            options={[
              {
                value: 'dots',
                label: t('account.canvas.dots'),
                icon: <Grip strokeWidth={1.75} aria-hidden />,
              },
              {
                value: 'grid',
                label: t('account.canvas.grid'),
                icon: <Grid3x3 strokeWidth={1.75} aria-hidden />,
              },
              {
                value: 'none',
                label: t('account.canvas.none'),
                icon: <Square strokeWidth={1.75} aria-hidden />,
              },
            ]}
          />
        </div>

        <div className="flex flex-col gap-1.5 px-2 pb-1 pt-1">
          <Label htmlFor="account-language" className="text-12 font-medium text-fg-3">
            {t('account.language.label')}
          </Label>
          <Select value={language} onValueChange={(next) => setLanguage(next as AppLocale)}>
            <SelectTrigger id="account-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SUPPORTED_LOCALES.map((locale) => (
                /* lang= switches the screen reader's voice for that one option (WCAG 3.1.2). */
                <SelectItem key={locale} value={locale} lang={locale}>
                  {LANGUAGE_ENDONYMS[locale]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* The whole UI changing language is silent otherwise. This confirms the switch to a
              screen-reader user, and carries the rollback message when the save fails. */}
          <p role="status" className="min-h-[1rem] text-12 text-fg-3">
            {saveFailed
              ? t('account.language.saveFailed')
              : isSaving
                ? t('account.language.saving')
                : ''}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 px-2 pb-2 pt-1">
          <div className="flex min-w-0 flex-col">
            <Label htmlFor="account-wallybot" className="text-12 font-medium text-fg-3">
              {t('account.wallybot.label')}
            </Label>
            <p id="account-wallybot-hint" className="text-12 text-fg-faint">
              {t('account.wallybot.hint')}
            </p>
          </div>
          <Switch
            id="account-wallybot"
            aria-label={t('account.wallybot.alwaysAsk')}
            aria-describedby="account-wallybot-hint"
            checked={!wallybot.autoApply}
            onCheckedChange={(on) => setWallybot({ autoApply: !on })}
          />
        </div>

        <MenuSeparator />
        {shortcuts && (
          <MenuItem icon={<Keyboard strokeWidth={1.75} />} shortcut="?" onClick={onShowShortcuts}>
            {t('account.shortcuts')}
          </MenuItem>
        )}
        <Link
          to="/settings/connections"
          className="flex min-h-9 items-center rounded px-2 text-13 text-fg-1 hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('connections.title')}
        </Link>
        <MenuItem icon={<LogOut strokeWidth={1.75} />} onClick={() => void signOut()}>
          {t('account.signOut')}
        </MenuItem>
      </PopoverContent>
    </Popover>
  );
}
