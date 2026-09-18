import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <p className="font-head text-32 font-semibold text-fg-1">404</p>
      <p className="text-14 text-fg-muted">Diese Seite gibt es nicht.</p>
      <Link to="/" className="text-13 font-medium text-fg-1 underline-offset-4 hover:underline">
        Zurück zur Startseite
      </Link>
    </div>
  );
}
