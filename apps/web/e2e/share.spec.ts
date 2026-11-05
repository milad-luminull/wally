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

  // Expiry (retention, 2026-11-04): seven days from today, then never. The run ends on
  // "never", so the shared test board's link never expires between runs.
  const inSevenDays = new Intl.DateTimeFormat('de', { dateStyle: 'medium' }).format(
    new Date(Date.now() + 7 * 86_400_000),
  );
  await page.getByRole('combobox', { name: 'Ablauf ändern' }).click();
  await page.getByRole('option', { name: '7 Tage' }).click();
  await expect(page.getByText(`Läuft ab am ${inSevenDays}`)).toBeVisible();
  await page.getByRole('combobox', { name: 'Ablauf ändern' }).click();
  await page.getByRole('option', { name: 'Nie' }).click();
  await expect(page.getByText('Läuft nie ab')).toBeVisible();
});
