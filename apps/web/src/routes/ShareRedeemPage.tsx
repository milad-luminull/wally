import { useEffect, useRef } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import type { ApiErrorKind } from '@/lib/apiClient';
import { Skeleton } from '@/components/ui/skeleton';
import { useRedeemShareLink } from '@/features/board/hooks/mutations/useRedeemShareLink';
import { AuthLayout } from './AuthLayout';

/**
 * The API mints share URLs as `${CORS_ORIGIN}/share/${token}` (apps/api/src/lib/dto.ts),
 * but the app had no route for them, so every link anyone sent fell straight through to
 * NotFoundPage. This page redeems the token and forwards to the board it unlocked.
 */
export function ShareRedeemPage() {
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
          title="Dieser Link funktioniert nicht mehr"
          subtitle="Er wurde zurückgezogen oder durch einen neuen ersetzt."
        >
          <div className="flex flex-col gap-4">
            <p role="alert" className="text-13 text-fg-muted">
              Bitte die Person, die dir den Link geschickt hat, um einen neuen.
            </p>
            <Link
              to="/"
              className="self-start text-13 font-medium text-fg-1 underline-offset-4 hover:underline"
            >
              Zu deiner Wand
            </Link>
          </div>
        </AuthLayout>
      );
    }

    return (
      <AuthLayout title="Das hat nicht geklappt" subtitle="Der Link konnte nicht eingelöst werden.">
        <div className="flex flex-col gap-4">
          <p role="alert" className="text-13 text-status-danger">
            Bitte versuche es noch einmal.
          </p>
          <button
            type="button"
            onClick={() => {
              if (!token) return;
              startedFor.current = token;
              mutate(token);
            }}
            className="self-start text-13 font-medium text-fg-1 underline-offset-4 hover:underline"
          >
            Erneut versuchen
          </button>
          <Link
            to="/"
            className="self-start text-13 text-fg-muted underline-offset-4 hover:underline"
          >
            Zu deiner Wand
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Einen Moment" subtitle="Wir fügen dich zur Wand hinzu.">
      <div className="flex flex-col gap-3" role="status" aria-label="Lädt…">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
    </AuthLayout>
  );
}
