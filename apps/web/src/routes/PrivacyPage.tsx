import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { PublicHeader } from '@/components/PublicHeader';
export function PrivacyPage() {
  const { t } = useTranslation();
  return (
    <div>
      <PublicHeader />
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-20 sm:px-8">
        <h1 className="text-2xl font-semibold">{t('privacy.title')}</h1>
        <p className="text-sm leading-relaxed">{t('privacy.intro')}</p>
        {(['service', 'providers', 'retention', 'rights'] as const).map((section) => (
          <section key={section} className="space-y-3">
            <h2 className="text-lg font-semibold">{t(`privacy.${section}Title`)}</h2>
            <p className="text-sm leading-relaxed text-fg-3">{t(`privacy.${section}`)}</p>
          </section>
        ))}
        <Link to="/settings/account" className="text-sm underline underline-offset-4">
          {t('accountData.title')}
        </Link>
      </main>
    </div>
  );
}
