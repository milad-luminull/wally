import { test, expect } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

test('public home exposes auth and retains every palette in both appearances', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Mehr Platz im Kopf.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Anmelden', exact: true })).toHaveAttribute(
    'href',
    '/login',
  );
  await expect(page.getByRole('link', { name: 'Registrieren', exact: true })).toHaveAttribute(
    'href',
    '/signup',
  );
  await page.getByRole('button', { name: 'Darstellung und Sprache' }).click();
  const palettes = {
    minimal: 'Minimal',
    paper: 'Paper Wall',
    morning: 'Clear Morning',
    highlighter: 'Highlighter',
    aurora: 'Aurora',
    daybreak: 'Daybreak',
    sprout: 'Sprout',
    amber: 'Amber Poster',
    neutral: 'Neutral',
  };
  for (const [id, name] of Object.entries(palettes)) {
    await page.getByRole('combobox', { name: 'Farbpalette' }).click();
    await page.getByRole('option', { name, exact: true }).click();
    for (const [mode, label] of [
      ['light', 'Hell'],
      ['dark', 'Dunkel'],
    ]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-palette', id);
      await expect(page.locator('html')).toHaveClass(new RegExp(mode));
    }
  }
  await page.getByRole('combobox', { name: 'Sprache', exact: true }).selectOption('en');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Get it out of your head.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'neutral');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('link', { name: 'Start your wall' }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Log in', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('link', { name: 'Sign up', exact: true }).click();
  await expect(page).toHaveURL(/\/signup$/);
});

test('signed-in palette and appearance survive a profile save and reload', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  await page.getByRole('button', { name: 'Konto', exact: true }).click();
  await page.getByRole('combobox', { name: 'Farbpalette' }).click();
  await page.getByRole('option', { name: 'Minimal', exact: true }).click();
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/me') &&
      response.request().method() === 'PATCH' &&
      response.ok() &&
      response.request().postDataJSON()?.preferences?.theme === 'dark',
  );
  await page.getByRole('button', { name: 'Dunkel', exact: true }).click();
  await saved;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Konto', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'minimal');
  await expect(page.locator('html')).toHaveClass(/dark/);
  // Docked dev tools and short laptop windows must not hide the relocated account menu.
  await page.setViewportSize({ width: 1080, height: 400 });
  await page.locator('.board-rail').hover();
  await page.mouse.wheel(0, 600);
  const account = page.getByRole('button', { name: 'Konto', exact: true });
  await expect
    .poll(() => account.evaluate((el) => el.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(400);
  await account.click();
  await expect(page.getByRole('combobox', { name: 'Farbpalette' })).toBeVisible();
});
