import { Trans, useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { PublicHeader } from '@/components/PublicHeader';
import { BrandMark } from '@/components/BrandMark';

/**
 * Shell for /login, /signup, share redemption and the 404 page: one narrow column on the
 * dotted wall, with a faint marigold glow from above. No card — the form is the page.
 *
 * `agreement` marks the pages where an account can be created (login and signup: Google
 * sign-in creates one on either), which state that continuing accepts the Terms. The legal
 * links are plain anchors: the pages are static HTML outside the React app.
 */
export function AuthLayout({
  title,
  subtitle,
  agreement = false,
  children,
}: {
  title: string;
  subtitle?: string;
  agreement?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="auth-page">
      <PublicHeader />
      <main className="auth-backdrop flex min-h-[100dvh] flex-col items-center justify-center px-4 py-12">
        <div className="auth-form-shell flex w-full max-w-[360px] animate-fade-in flex-col gap-8">
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="flex items-center gap-2">
              <BrandMark size={28} />
              <span className="text-20 font-semibold tracking-[-0.04em] text-fg-1">wally</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <h1 className="text-20 font-semibold text-fg-1">{title}</h1>
              {subtitle && <p className="text-14 text-fg-3">{subtitle}</p>}
            </div>
          </div>
          {children}
          <p className="text-center text-13 text-fg-3 [&_a:hover]:text-fg-1 [&_a]:underline [&_a]:underline-offset-4">
            {agreement ? (
              <Trans
                i18nKey="legal.agreement"
                components={{ terms: <a href="/terms" />, privacy: <a href="/privacy" /> }}
              />
            ) : (
              <span className="flex justify-center gap-4">
                <a href="/privacy">{t('legal.privacy')}</a>
                <a href="/terms">{t('legal.terms')}</a>
              </span>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
