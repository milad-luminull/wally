import { test, expect } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

test('a note made private shows a lock and stays under "Nur private"', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  const title = `E2E-Privat ${Date.now()}`;
  await page.getByRole('button', { name: 'Neue Notiz' }).click();
  const titleField = page.getByLabel('Titel');
  await titleField.fill(title);
  await titleField.blur();

  await page.getByRole('switch', { name: 'Privat' }).click();
  await expect(page.getByText('Jetzt privat. Nur du siehst diese Notiz.')).toBeVisible();

  await page.getByRole('button', { name: 'Schließen' }).click();
  await expect(titleField).toBeHidden();

  const onlyPrivate = page.getByRole('radio', { name: 'Nur private' });
  await onlyPrivate.click();
  await expect(page.getByText(title)).toBeVisible();
  await expect(page.getByRole('img', { name: 'Private Notiz' }).first()).toBeVisible();

  // Remembered per board, so it survives a reload.
  await page.reload();
  await expect(onlyPrivate).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(title)).toBeVisible();

  // Leave the board's view as the other specs expect it.
  await onlyPrivate.click();
  await expect(onlyPrivate).toHaveAttribute('aria-checked', 'false');
});
