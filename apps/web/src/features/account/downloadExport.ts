import { accountExportSchema } from '@wally/shared';
import { api } from '@/lib/apiClient';

/** How long the saved blob stays alive: some browsers read it after click() returns. */
const REVOKE_AFTER_MS = 60_000;

/** Fetches GET /me/export with the session's token and saves it as one JSON file. */
export async function downloadExport(): Promise<void> {
  const data = await api.get('/me/export', accountExportSchema);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `wally-export-${data.exportedAt.slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
