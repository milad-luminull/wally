import type { ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';

/**
 * Shell for /login and /signup. The board itself is the product's visual signature, so the
 * same dotted linen surface carries over here instead of dropping the user onto a plain
 * grey page with a floating box.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="board-surface flex min-h-[100dvh] flex-col items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-[380px] flex-col gap-6">
        {/* The lockup. Gap equals the pin diameter (21% of the mark's side, so 7.56px at
            36px) and the wordmark is lowercase — "wally" in the logo, "Wally" in running
            text. A letter in a box is on the guideline's don't list; this is the mark. */}
        <div className="flex items-center gap-[7.56px]">
          <BrandMark size={36} />
          <span className="text-22 font-bold tracking-[-0.045em] text-fg-1">wally</span>
        </div>

        <div className="rounded-2xl border border-border-subtle bg-card p-7 shadow-e2">
          <div className="mb-6 flex flex-col gap-1.5">
            <h1 className="font-head text-22 font-bold text-fg-1">{title}</h1>
            <p className="text-14 text-fg-muted">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
