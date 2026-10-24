import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { WhiteboardSummaryDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { boardsApi } from '@/lib/resources';
import { cn } from '@/lib/cn';
import { useQueryKeys } from '@/features/board/hooks/queryKeys';
import type { MessageKey } from '@/i18n/keys';
import { useAuth } from './AuthProvider';

const RESEND_COOLDOWN_SECONDS = 60;

/** Holds a catalogue KEY, not resolved copy, so a message already on screen re-renders in the
 * new language after a switch — see the note in SignInForm. */
type Feedback = { tone: 'info' | 'error'; key: MessageKey } | null;

function friendlyResendError(err: unknown): MessageKey {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'auth/too-many-requests') return 'auth.verify.tooMany';
  return 'auth.verify.sendFailed';
}

/**
 * The API gates activation of a pending board invite on the token's `email_verified` claim
 * (apps/api/src/plugins/auth.ts). Without this banner, a colleague who signs up with a
 * password lands on their own empty board and can never reach the board they were invited
 * to, with nothing anywhere in the UI explaining why.
 */
export function EmailVerificationBanner() {
  const { t } = useTranslation();
  const {
    user,
    emailVerified,
    resendVerificationEmail,
    refreshUser,
    hostedLogin,
    verificationSendFailed,
  } = useAuth();
  const queryClient = useQueryClient();
  const keys = useQueryKeys();

  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState<'resend' | 'confirm' | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [unlocked, setUnlocked] = useState<WhiteboardSummaryDto | null>(null);

  // A setTimeout chain rather than setInterval: cleanup is a single clearTimeout, and the
  // countdown can never outlive the component or double up under StrictMode.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  async function handleResend() {
    setBusy('resend');
    setFeedback(null);
    try {
      await resendVerificationEmail();
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setFeedback({ tone: 'info', key: 'auth.verify.sent' });
    } catch (err) {
      // Firebase throttles server-side too, so the cooldown starts either way — otherwise a
      // rejected send could be hammered into a longer lockout.
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setFeedback({ tone: 'error', key: friendlyResendError(err) });
    } finally {
      setBusy(null);
    }
  }

  async function handleConfirm() {
    setBusy('confirm');
    setFeedback(null);
    try {
      const verified = await refreshUser();
      if (!verified) {
        setFeedback({ tone: 'error', key: 'auth.verify.notYet' });
        return;
      }

      // The token now carries email_verified. The API activates the pending invite in its
      // auth preHandler on the NEXT request, so this refetch both performs the activation
      // and returns the result. Everything is invalidated rather than just the boards list:
      // the caller's server-side permissions just changed, so every cached response is
      // suspect. Order matters — invalidating before the refresh would refetch with the old
      // token and activate nothing.
      const boards = await queryClient.fetchQuery({
        queryKey: keys.meBoards(),
        staleTime: 0,
        queryFn: () => boardsApi.list(),
      });
      await queryClient.invalidateQueries();

      // A newly activated invite would otherwise be easy to miss: the user stays on the board
      // they own, and the switcher only gains the new entry quietly. Surface it as a link.
      setUnlocked(boards.find((board) => board.currentUserRole !== 'OWNER') ?? null);
    } catch {
      setFeedback({ tone: 'error', key: 'auth.verify.confirmFailed' });
    } finally {
      setBusy(null);
    }
  }

  if (!user) return null;
  if (hostedLogin && !emailVerified)
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-surface-alt p-3 text-13">
        <div className="min-w-0 flex-1">
          <p role="status">{t('auth.hosted.verify')}</p>
          {feedback && (
            <p role={feedback.tone === 'error' ? 'alert' : 'status'} className="text-status-danger">
              {t(feedback.key)}
            </p>
          )}
        </div>
        <Button variant="outline" disabled={busy !== null} onClick={() => void handleConfirm()}>
          {t(busy === 'confirm' ? 'auth.verify.confirming' : 'auth.verify.confirm')}
        </Button>
      </div>
    );

  if (emailVerified) {
    if (!unlocked) return null;
    return (
      <div className="z-header shrink-0 border-b border-border bg-surface-alt text-fg-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
          <CheckCircle2
            aria-hidden
            className="h-4 w-4 shrink-0 text-status-success"
            strokeWidth={1.75}
          />
          <p role="status" className="text-13 font-medium text-status-success">
            {t('auth.verify.unlocked', { name: unlocked.name })}
          </p>
          <Link
            to={`/boards/${unlocked.id}`}
            onClick={() => setUnlocked(null)}
            className="text-13 font-medium underline underline-offset-4"
          >
            {t('auth.verify.openBoard')}
          </Link>
        </div>
      </div>
    );
  }

  const resendDisabled = busy !== null || cooldown > 0;

  return (
    <div className="z-header shrink-0 border-b border-border bg-surface-alt text-fg-1">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <AlertTriangle
          aria-hidden
          className="h-4 w-4 shrink-0 text-status-warning"
          strokeWidth={1.75}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-13 font-medium text-status-warning">{t('auth.verify.title')}</p>
          {/* The email at sign-up did not go out: said, never "on its way". Resend is below. */}
          {verificationSendFailed && !feedback ? (
            <p role="alert" className="text-12 font-medium text-status-danger">
              {t('auth.verify.sendFailed')}
            </p>
          ) : (
            <p className="text-12 text-fg-3">
              {/* <Trans>, not interpolation: the <span> sits mid-sentence and moves clause
                  position in English, so the markup has to travel with the words. */}
              <Trans
                i18nKey="auth.verify.sentTo"
                values={{ email: user.email ?? '' }}
                components={{ strong: <span className="font-medium" /> }}
              />
            </p>
          )}
          {feedback && (
            <p
              role={feedback.tone === 'error' ? 'alert' : 'status'}
              className={cn(
                'text-12 font-medium',
                feedback.tone === 'error' ? 'text-status-danger' : 'text-fg-muted',
              )}
            >
              {t(feedback.key)}
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void handleResend()}
            disabled={resendDisabled}
          >
            {busy === 'resend'
              ? t('auth.verify.resending')
              : cooldown > 0
                ? t('auth.verify.resendIn', { seconds: cooldown })
                : t('auth.verify.resend')}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={busy !== null}
          >
            {busy === 'confirm' ? t('auth.verify.confirming') : t('auth.verify.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
