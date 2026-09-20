import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="board-surface flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10 text-center">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl border border-border-subtle bg-card px-10 py-9 shadow-e2">
        <p className="font-head text-32 font-bold tabular-nums text-fg-faint">404</p>
        <h1 className="font-head text-18 font-bold text-fg-1">{t('routes.notFound.title')}</h1>
        <p className="text-13 text-fg-muted">
          {t('routes.notFound.body')}
        </p>
        <Link
          to="/"
          className="mt-2 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-13 font-medium text-primary-foreground shadow-e1 transition-[background-color,box-shadow,transform] duration-150 ease-ds hover:bg-[color:var(--petrol-mid)] hover:shadow-e2 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)] focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:active:scale-100"
        >
          {t('routes.notFound.action')}
        </Link>
      </div>
    </main>
  );
}
