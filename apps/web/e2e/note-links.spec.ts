import { test, expect } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

test('a note is linked to another from the panel and the other lists it back', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  const stamp = Date.now();
  const first = `E2E link target ${stamp}`;
  const second = `E2E link source ${stamp}`;
  await captureNote(page, first);
  const panel = await captureNote(page, second, { open: true });

  await panel.getByRole('button', { name: 'Notiz verknüpfen…' }).click();
  await page.getByLabel('Notiz suchen').fill(first);
  await page.getByRole('option', { name: first }).click();
  const row = panel.getByRole('button', { name: first });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('title', `Verknüpft mit ${first}`);

  // The other note lists the link back, read-only.
  await row.click();
  await expect(panel.getByRole('button', { name: second })).toHaveAttribute(
    'title',
    `Verknüpft von ${second}`,
  );
  await expect(
    panel.getByRole('button', { name: `Verknüpfung zu ${second} entfernen` }),
  ).toHaveCount(0);
});
