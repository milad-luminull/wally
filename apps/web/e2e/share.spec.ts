import { test, expect } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

test('inviting a colleague and copying the share link', async ({ page, context }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await signIn(page);

  await page.getByRole('button', { name: 'Board teilen' }).click();
  await expect(
    page.getByRole('heading', { name: /teilen$/ }).filter({ visible: true }),
  ).toBeVisible();

  const email = `e2e-invite-${Date.now()}@example.com`;
  await page.getByLabel('E-Mail-Adresse einladen').fill(email);
  await page.getByRole('button', { name: 'Zum Board einladen' }).click();

  // The toast also contains the email, and other invitations may still be pending.
  const invitedEmail = page.getByText(email, { exact: true });
  await expect(invitedEmail).toBeVisible();
  await expect(invitedEmail.locator('..').getByText('Ausstehend', { exact: true })).toBeVisible();

  const enable = page.getByRole('button', { name: 'Link-Freigabe aktivieren' });
  if (await enable.isVisible()) await enable.click();
  await page.getByRole('button', { name: 'Board-Link kopieren' }).click();
  await expect(page.getByRole('button', { name: 'Kopiert' })).toBeVisible();
});
