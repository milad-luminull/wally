import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_USER_EMAIL ?? '';
const PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

test('sign in with email/password loads the seeded board', async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Ab an die Wand. Wally macht den Rest.' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Anmelden', exact: true }).click();
  await page.getByLabel('E-Mail').fill(EMAIL);
  await page.getByLabel('Passwort').fill(PASSWORD);
  // `exact`: name matching is substring by default, and "Mit Google anmelden" contains it.
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

  await page.waitForURL(/\/boards\/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByText(/offen/)).toBeVisible();
});

test('signed-in visitors still see the public root and can return to their boards', async ({
  page,
}) => {
  test.skip(!EMAIL || !PASSWORD, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(EMAIL);
  await page.getByLabel('Passwort').fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL(/\/boards(\/[^/?#]+)?(\?.*)?$/);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Ab an die Wand. Wally macht den Rest.' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  const openWally = page
    .getByRole('banner')
    .getByRole('link', { name: 'Wally öffnen', exact: true });
  await expect(openWally).toHaveAttribute('href', '/boards');
  await expect(page.getByRole('link', { name: 'Anmelden', exact: true })).toHaveCount(0);
  await openWally.click();
  await page.waitForURL(/\/boards(\/[^/?#]+)?(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});
