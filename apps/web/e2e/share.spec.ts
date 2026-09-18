import { test, expect } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

test('inviting a colleague and copying the share link', async ({ page, context }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);

  await signIn(page);

  await page.getByRole('button', { name: 'Teilen' }).click();
  await expect(page.getByText('Wand teilen')).toBeVisible();

  const email = `e2e-invite-${Date.now()}@finlex.de`;
  await page.getByLabel('E-Mail-Adresse einladen').fill(email);
  await page.getByRole('button', { name: 'Einladen' }).click();

  await expect(page.getByText(email)).toBeVisible();
  await expect(page.getByText('Ausstehend')).toBeVisible();

  await page.getByRole('button', { name: 'Kopieren' }).click();
  await expect(page.getByRole('button', { name: 'Kopiert' })).toBeVisible();
});
