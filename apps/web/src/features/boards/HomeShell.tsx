import type { ReactNode } from 'react';
import { BrandMark } from '@/components/BrandMark';
import { EmailVerificationBanner } from '@/features/auth/EmailVerificationBanner';
import { AccountMenu } from '@/features/board/AccountMenu';

/**
 * The chrome of the board home: the same header height, border and account menu as a board,
 * without any board tools (RFC BOARD_HOME §7.1).
 */
export function HomeShell({ children }: { children: ReactNode }) {
  return (
    <div className="boards-home-shell flex h-[100dvh] flex-col overflow-hidden bg-background">
      <EmailVerificationBanner />
      <header className="z-header flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 lg:px-4 [@media(pointer:coarse)]:h-14">
        <BrandMark size={20} className="shrink-0" />
        <div className="flex-1" />
        <div className="ml-1 flex items-center border-l border-border-subtle pl-2.5">
          {/* The shortcuts help lives with a board's command layer, which is not mounted here. */}
          <AccountMenu shortcuts={false} />
        </div>
      </header>
      <main className="wally-scroll min-h-0 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
