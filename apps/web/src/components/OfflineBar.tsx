import { useSyncExternalStore } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

/**
 * A slim notice while the browser is offline (the error handling spec, 2026-10-19). TanStack
 * Query pauses queries and mutations while offline and resumes them on reconnect
 * (https://tanstack.com/query/v5/docs/framework/react/guides/network-mode); this reads the
 * same signal, so what it says is what the app does.
 */
export function OfflineBar() {
  const { t } = useTranslation();
  const online = useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
  );
  if (online) return null;
  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-toast -translate-x-1/2 rounded-full bg-fg-1 px-4 py-2 text-13 text-surface shadow-e3"
    >
      {t('errors.offline')}
    </div>
  );
}
