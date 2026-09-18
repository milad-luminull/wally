import type { ReactNode } from 'react';

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-e2">
        <div className="mb-6 flex flex-col gap-1">
          <h1 className="font-head text-22 font-semibold tracking-[-0.02em] text-fg-1">{title}</h1>
          <p className="text-13 text-fg-muted">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
