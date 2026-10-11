import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AuthLayout } from './AuthLayout';

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <AuthLayout title={t('routes.notFound.title')} subtitle={t('routes.notFound.body')}>
      <div className="flex flex-col items-center gap-6">
        <p aria-hidden className="font-mono text-28 font-medium tabular-nums text-fg-faint">
          404
        </p>
        <Button asChild variant="default" size="lg">
          <Link to="/">
            <ArrowLeft strokeWidth={1.75} />
            {t('routes.notFound.action')}
          </Link>
        </Button>
      </div>
    </AuthLayout>
  );
}
