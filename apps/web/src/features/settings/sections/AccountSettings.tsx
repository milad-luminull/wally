import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { DeleteAccountDialog } from '@/features/account/DeleteAccountDialog';
import { downloadExport } from '@/features/account/downloadExport';
import { SettingsSection } from '../SettingsSection';
import { SettingRow } from '../SettingRow';

/** Download everything you can see, or delete your account (the account deletion design). */
export function AccountSettings() {
  const { t } = useTranslation();
  const exportHintId = useId();
  const deleteHintId = useId();
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
    <SettingsSection id="account">
      <SettingRow
        label={t('accountData.exportTitle')}
        hint={t('accountData.exportHint')}
        hintId={exportHintId}
      >
        <Button
          variant="outline"
          disabled={downloading}
          aria-describedby={exportHintId}
          onClick={download}
        >
          {t('accountData.download')}
        </Button>
        {exportFailed && (
          <p role="alert" className="text-12 text-status-danger">
            {t('accountData.exportFailed')}
          </p>
        )}
      </SettingRow>
      <SettingRow
        label={t('settings.account.accountLabel')}
        hint={t('accountData.deleteHint')}
        hintId={deleteHintId}
      >
        <Button
          variant="destructive"
          aria-describedby={deleteHintId}
          onClick={() => setDeleting(true)}
        >
          {t('accountData.deleteTitle')}
        </Button>
      </SettingRow>
      <DeleteAccountDialog open={deleting} onOpenChange={setDeleting} />
      {/* Plain links: the legal pages are static HTML outside the React app. */}
      <div className="settings-foot">
        <a href="/privacy" className="underline underline-offset-4">
          {t('legal.privacy')}
        </a>
        <a href="/terms" className="underline underline-offset-4">
          {t('legal.terms')}
        </a>
      </div>
    </SettingsSection>
  );
}
