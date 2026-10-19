import { Component, type ErrorInfo, type ReactNode } from 'react';
import { i18n } from '@/i18n';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Reload; the page by default. */
  onReload?: () => void;
  /** Smaller, for a part of the page (the sidebar) rather than the whole of it. */
  inline?: boolean;
}

/**
 * Catches a render error so the person sees "Something went wrong · Reload" instead of a blank
 * page (the error handling spec, 2026-10-19; React's error boundaries:
 * https://react.dev/reference/react/Component). Only the part inside it is replaced.
 */
export class ErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // No reporting service on this stack: the console is where a developer finds it.
    console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const reload = this.props.onReload ?? (() => window.location.reload());
    return (
      <div
        role="alert"
        className={
          this.props.inline
            ? 'flex flex-col items-start gap-2 p-5'
            : 'flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center'
        }
      >
        <p className="text-14 font-medium text-fg-1">{i18n.t('errors.crash.title')}</p>
        <p className="text-13 text-fg-3">{i18n.t('errors.crash.hint')}</p>
        <Button size="sm" onClick={reload}>
          {i18n.t('errors.crash.reload')}
        </Button>
      </div>
    );
  }
}
