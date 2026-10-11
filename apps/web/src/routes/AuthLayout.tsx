import type { ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';

/**
 * Shell for /login, /signup, share redemption and the 404 page: one narrow column on the
 * dotted wall, with a faint marigold glow from above. No card — the form is the page.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-backdrop flex min-h-[100dvh] flex-col items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-[360px] animate-fade-in flex-col gap-8">
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
      </div>
    </main>
  );
}
