import { test, expect } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

test('creating a note from the top bar opens it for editing', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  const title = `E2E-Notiz ${Date.now()}`;
  await page.getByRole('button', { name: 'Neue Notiz' }).click();

  const titleField = page.getByLabel('Titel');
  await expect(titleField).toBeVisible();
  await titleField.fill(title);
  await titleField.blur();

  await page.getByRole('button', { name: 'Schließen' }).click();
  await page.getByLabel('Notizen durchsuchen').fill(title);

  await expect(page.getByText(title)).toBeVisible();
});
