import type { ReactNode } from 'react';

/**
 * Shell for /login and /signup. The board itself is the product's visual signature, so the
 * same dotted petrol surface carries over here instead of dropping the user onto a plain
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
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="font-head flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-15 font-bold text-primary-foreground shadow-e1"
          >
            W
          </span>
          <span className="font-head text-18 font-bold text-fg-1">Wally</span>
        </div>

        <div className="rounded-2xl border border-border-subtle bg-card p-7 shadow-e2">
          <div className="mb-6 flex flex-col gap-1.5">
            <h1 className="font-head text-22 font-bold text-fg-1">{title}</h1>
            <p className="text-13 text-fg-muted">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
