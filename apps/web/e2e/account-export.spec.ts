import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { EMAIL, hasE2eCredentials, signIn } from './support';

test('downloads everything the account can see as one JSON file', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  await page.goto('/settings/account');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Meine Daten herunterladen' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^wally-export-\d{4}-\d{2}-\d{2}\.json$/);

  const data = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    profile: { email: string };
    boards: { name: string; notes: unknown[] }[];
  };
  expect(data.profile.email).toBe(EMAIL.toLowerCase());
  const board = data.boards.find((b) => b.name === 'Meine Wand');
  expect(board?.notes.length).toBeGreaterThan(0);
});
