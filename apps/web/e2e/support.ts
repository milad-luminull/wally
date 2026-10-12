import type { Page } from '@playwright/test';

const EMAIL = process.env.E2E_USER_EMAIL ?? '';
const PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

export const hasE2eCredentials = Boolean(EMAIL && PASSWORD);

export async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByLabel('E-Mail').fill(EMAIL);
  await page.getByLabel('Passwort').fill(PASSWORD);
  // `exact`: name matching is substring by default, and "Mit Google anmelden" contains it.
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await page.waitForURL(/\/boards\/.+/);
}
