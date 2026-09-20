import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { WhiteboardSummaryDto } from '@wally/shared';
import { Button } from '@/components/ui/button';
import { boardsApi } from '@/lib/resources';
import { queryKeys } from '@/features/board/hooks/queryKeys';
import { useAuth } from './AuthProvider';

const RESEND_COOLDOWN_SECONDS = 60;

type Feedback = { tone: 'info' | 'error'; message: string } | null;

function friendlyResendError(err: unknown): string {
  const code = (err as { code?: string } | undefined)?.code;
  if (code === 'auth/too-many-requests') return 'Zu viele Versuche. Bitte warte einen Moment.';
  return 'Die E-Mail konnte nicht gesendet werden. Bitte erneut versuchen.';
}

/**
 * The API gates activation of a pending board invite on the token's `email_verified` claim
 * (apps/api/src/plugins/auth.ts). Without this banner, a colleague who signs up with a
 * password lands on their own empty board and can never reach the board they were invited
 * to, with nothing anywhere in the UI explaining why.
 */
export function EmailVerificationBanner() {
  const { user, emailVerified, resendVerificationEmail, refreshUser } = useAuth();
  const queryClient = useQueryClient();

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
      setFeedback({ tone: 'info', message: 'E-Mail gesendet. Schau auch im Spam-Ordner nach.' });
    } catch (err) {
      // Firebase throttles server-side too, so the cooldown starts either way — otherwise a
      // rejected send could be hammered into a longer lockout.
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setFeedback({ tone: 'error', message: friendlyResendError(err) });
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
        setFeedback({
          tone: 'error',
          message: 'Noch nicht bestätigt. Klicke zuerst den Link in der E-Mail.',
        });
        return;
      }

      // The token now carries email_verified. The API activates the pending invite in its
      // auth preHandler on the NEXT request, so this refetch both performs the activation
      // and returns the result. Everything is invalidated rather than just the boards list:
      // the caller's server-side permissions just changed, so every cached response is
      // suspect. Order matters — invalidating before the refresh would refetch with the old
      // token and activate nothing.
      const boards = await queryClient.fetchQuery({
        queryKey: queryKeys.meBoards(),
        queryFn: () => boardsApi.list(),
      });
      await queryClient.invalidateQueries();

      // There is no board switcher in the app, so a newly activated invite would otherwise
      // be invisible: the user stays on the board they own with no way to reach the one
      // they were invited to. Surface it as a link instead of silently disappearing.
      setUnlocked(boards.find((board) => board.currentUserRole !== 'OWNER') ?? null);
    } catch {
      setFeedback({ tone: 'error', message: 'Das hat nicht geklappt. Bitte erneut versuchen.' });
    } finally {
      setBusy(null);
    }
  }

  if (!user) return null;

  if (emailVerified) {
    if (!unlocked) return null;
    return (
      <div className="z-header shrink-0 border-b border-[rgba(2,71,79,0.14)] bg-[color:var(--status-success-bold)] text-[color:var(--on-status-success)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 lg:px-7">
          <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          <p role="status" className="text-13 font-semibold">
            E-Mail bestätigt. Du hast jetzt Zugriff auf „{unlocked.name}“.
          </p>
          <Link
            to={`/boards/${unlocked.id}`}
            onClick={() => setUnlocked(null)}
            className="text-13 font-medium underline underline-offset-4"
          >
            Wand öffnen
          </Link>
        </div>
      </div>
    );
  }

  const resendDisabled = busy !== null || cooldown > 0;

  return (
    <div className="z-header shrink-0 border-b border-[rgba(2,71,79,0.14)] bg-[color:var(--status-warning-bold)] text-[color:var(--on-status-warning)]">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 lg:px-7">
        <AlertTriangle aria-hidden className="h-4 w-4 shrink-0" strokeWidth={2.2} />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-13 font-semibold">Bestätige deine E-Mail-Adresse</p>
          <p className="text-12">
            Wir haben dir eine E-Mail an <span className="font-medium">{user.email}</span>{' '}
            geschickt. Erst danach können wir dich zu einer Wand hinzufügen, zu der du
            eingeladen wurdest.
          </p>
          {feedback && (
            <p
              role={feedback.tone === 'error' ? 'alert' : 'status'}
              className="text-12 font-medium"
            >
              {feedback.message}
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
            /* The base class pins the focus ring's offset to the page background, which
               would halo oddly against the amber field. */
            className="focus-visible:ring-offset-[color:var(--status-warning-bold)]"
          >
            {busy === 'resend'
              ? 'Sende…'
              : cooldown > 0
                ? `Erneut senden in ${cooldown}s`
                : 'E-Mail erneut senden'}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={busy !== null}
            className="focus-visible:ring-offset-[color:var(--status-warning-bold)]"
          >
            {busy === 'confirm' ? 'Prüfe…' : 'Ich habe bestätigt'}
          </Button>
        </div>
      </div>
    </div>
  );
}
