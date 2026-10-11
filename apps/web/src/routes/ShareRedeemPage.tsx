import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import type { ApiErrorKind } from '@/lib/apiClient';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { useRedeemShareLink } from '@/features/board/hooks/mutations/useRedeemShareLink';
import { AuthLayout } from './AuthLayout';

/**
 * The API mints share URLs as `${CORS_ORIGIN}/share/${token}` (apps/api/src/lib/dto.ts),
 * but the app had no route for them, so every link anyone sent fell straight through to
 * NotFoundPage. This page redeems the token and forwards to the board it unlocked.
 */
export function ShareRedeemPage() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const redeem = useRedeemShareLink();
  const { mutate } = redeem;

  // useMutation does not dedupe — nothing keys it — so React's double-invoked mount effect
  // would fire two POSTs. The ref holds the token already started: refs survive the
  // simulated remount, and keying on the token still allows a genuine navigation to a
  // DIFFERENT share link to redeem. (Redemption is idempotent server-side, but that is a
  // reason the guard is cheap insurance, not a reason to drop it.)
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token || startedFor.current === token) return;
    startedFor.current = token;
    mutate(token);
  }, [token, mutate]);

  if (redeem.isSuccess) {
    return <Navigate to={`/boards/${redeem.data.whiteboardId}`} replace />;
  }

  if (redeem.isError) {
    const kind = (redeem.error as { kind?: ApiErrorKind } | undefined)?.kind;

    if (kind === 'not_found') {
      return (
        <AuthLayout
          title={t('routes.redeem.gone.title')}
          subtitle={t('routes.redeem.gone.subtitle')}
        >
          <div className="flex flex-col gap-4">
            <p role="alert" className="text-center text-14 text-fg-3">
              {t('routes.redeem.gone.body')}
            </p>
            <Button asChild variant="outline" size="lg" className="w-full">
              <Link to="/">{t('routes.redeem.toBoard')}</Link>
            </Button>
          </div>
        </AuthLayout>
      );
    }

    return (
      <AuthLayout
        title={t('routes.redeem.failed.title')}
        subtitle={t('routes.redeem.failed.subtitle')}
      >
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-center text-14 text-status-danger">
            {t('routes.redeem.failed.body')}
          </p>
          <Button
            size="lg"
            className="w-full"
            onClick={() => {
              if (!token) return;
              startedFor.current = token;
              mutate(token);
            }}
          >
            {t('common.retry')}
          </Button>
          <Button asChild variant="ghost" size="lg" className="w-full">
            <Link to="/">{t('routes.redeem.toBoard')}</Link>
          </Button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t('routes.redeem.pending.title')}
      subtitle={t('routes.redeem.pending.subtitle')}
    >
      <div
        className="flex flex-col items-center gap-3"
        role="status"
        aria-label={t('common.loading')}
      >
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-4 w-40" />
      </div>
    </AuthLayout>
  );
}
