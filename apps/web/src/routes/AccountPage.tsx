import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { HomeShell } from '@/features/boards/HomeShell';
import { Button } from '@/components/ui/button';
import { DeleteAccountDialog } from '@/features/account/DeleteAccountDialog';
import { downloadExport } from '@/features/account/downloadExport';

/** Download everything you can see, or delete your account (the account deletion design). */
export function AccountSettings() {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function download() {
    setDownloading(true);
    setExportFailed(false);
    try {
      await downloadExport();
    } catch {
      setExportFailed(true);
    } finally {
      setDownloading(false);
    }
  }

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
        <Button
          variant="outline"
          disabled={downloading}
          aria-describedby="export-hint"
          onClick={download}
        >
          {t('accountData.download')}
        </Button>
        {exportFailed && (
          <p role="alert" className="text-sm text-status-danger">
            {t('accountData.exportFailed')}
          </p>
        )}
      </section>
      <section className="space-y-3 border-t border-border pt-6" aria-labelledby="delete-title">
        <h2 id="delete-title" className="text-lg font-semibold">
          {t('accountData.deleteTitle')}
        </h2>
        <p id="delete-hint" className="text-sm text-fg-3">
          {t('accountData.deleteHint')}
        </p>
        <Button
          variant="destructive"
          aria-describedby="delete-hint"
          onClick={() => setDeleting(true)}
        >
          {t('accountData.deleteTitle')}
        </Button>
        <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
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
