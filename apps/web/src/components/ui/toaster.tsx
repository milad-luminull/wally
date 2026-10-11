import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dismissToast, useToasts, type Toast } from '@/lib/toast';

const DEFAULT_DURATION = 5000;
const ERROR_DURATION = 7000;

function ToastItem({ toast }: { toast: Toast }) {
  const { t } = useTranslation();
  const [paused, setPaused] = useState(false);
  const remaining = useRef(
    toast.duration ?? (toast.tone === 'error' ? ERROR_DURATION : DEFAULT_DURATION),
  );
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => dismissToast(toast.id, { expired: true }), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt.current;
    };
  }, [paused, toast.id]);

  const isError = toast.tone === 'error';

  return (
    <li
      role={isError ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cn(
        'pointer-events-auto flex min-h-11 w-full animate-pop-in items-center gap-2.5 rounded-lg border border-border bg-popover py-1.5 pl-3.5 pr-1.5 text-13 text-fg-1 shadow-e3',
      )}
    >
      {isError && (
        <AlertCircle
          aria-hidden
          className="h-4 w-4 shrink-0 text-status-danger"
          strokeWidth={1.75}
        />
      )}
      <p className="min-w-0 flex-1">{t(toast.title, toast.values)}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick();
            dismissToast(toast.id, { expired: false });
          }}
          className="h-7 shrink-0 rounded-md px-2 text-13 font-medium text-fg-1 underline-offset-4 transition-colors hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
        >
          {t(toast.action.label)}
        </button>
      )}
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={() => dismissToast(toast.id, { expired: true })}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-inset hover:text-fg-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring-alpha)]"
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.75} />
      </button>
    </li>
  );
}

/**
 * Bottom-centre stack, newest last. Polite for confirmations, assertive (role=alert) for
 * failures. Hovering or focusing a toast pauses its timer, so an undo is never yanked away
 * from under the pointer.
 */
export function Toaster() {
  const toasts = useToasts();
  return createPortal(
    <ol
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-toast mx-auto flex w-[calc(100%-32px)] max-w-[420px] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </ol>,
    document.body,
  );
}
