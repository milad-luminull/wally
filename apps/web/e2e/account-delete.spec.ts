import { test, expect } from '@playwright/test';
import { EMAIL, hasE2eCredentials, signIn } from './support';

/**
 * Deletes the test account's Wally data, so it runs in its own project after every other
 * spec (playwright.config.ts). CI's database is new for every run, and CI has no Auth0
 * Management secret, so the Auth0 test user stays (e2e/README.md).
 */
test('deletes the account after the email is typed, and signs out', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  await page.goto('/settings/account');
  await page.getByRole('button', { name: 'Konto löschen' }).click();

  const dialog = page.getByRole('alertdialog');
  await expect(dialog.getByText(/^Meine Wand/)).toBeVisible();
  const confirm = dialog.getByRole('button', { name: 'Mein Konto löschen' });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/ein, um zu bestätigen$/).fill(EMAIL);
  await confirm.click();

  await page.waitForURL(/\/login/);
  await expect(page.getByText('Dein Konto ist gelöscht.')).toBeVisible();
});
