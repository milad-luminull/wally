import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { HomeShell } from '@/features/boards/HomeShell';
import { Button } from '@/components/ui/button';

/**
 * Self-service export and deletion are not available yet. The page keeps its place in the
 * settings so the controls can return without moving, and says how to reach us meanwhile.
 */
export function AccountSettings() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-8 sm:py-12">
      <div className="space-y-3">
        <Link to="/boards" className="text-sm underline underline-offset-4">
          {t('connections.back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('accountData.title')}</h1>
        <Link to="/privacy" className="text-sm underline underline-offset-4">
          {t('privacy.title')}
        </Link>
      </div>
      <section className="space-y-3" aria-labelledby="export-title">
        <h2 id="export-title" className="text-lg font-semibold">
          {t('accountData.exportTitle')}
        </h2>
        <p id="export-hint" className="text-sm text-fg-3">
          {t('accountData.exportHint')}
        </p>
        <Button variant="outline" disabled aria-describedby="export-hint">
          {t('accountData.download')}
        </Button>
      </section>
      <section className="space-y-3 border-t border-border pt-6" aria-labelledby="delete-title">
        <h2 id="delete-title" className="text-lg font-semibold">
          {t('accountData.deleteTitle')}
        </h2>
        <p id="delete-hint" className="text-sm text-fg-3">
          {t('accountData.deleteHint')}
        </p>
        <Button variant="destructive" disabled aria-describedby="delete-hint">
          {t('accountData.deleteTitle')}
        </Button>
      </section>
    </div>
  );
}
export function AccountPage() {
  return (
    <HomeShell>
      <AccountSettings />
    </HomeShell>
  );
}
