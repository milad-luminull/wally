import { test, expect, type Page } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

/**
 * Settings (docs/superpowers/specs/2026-11-08-settings-design.md): one place for every
 * setting, styled like the board, and Back returns to the page it was opened from.
 */

async function openSettingsFromRail(page: Page) {
  await page
    .locator('.board-rail')
    .getByRole('link', { name: 'Einstellungen', exact: true })
    .click();
  await expect(page).toHaveURL(/\/settings\/appearance$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Darstellung' })).toBeVisible();
}

test('opens settings from a board and Back returns to the same board', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  const board = page.url();

  await openSettingsFromRail(page);
  const nav = page.getByRole('navigation', { name: 'Einstellungen' });
  await nav.getByRole('link', { name: 'Sprache', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sprache' })).toBeVisible();
  await nav.getByRole('link', { name: 'Darstellung', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Darstellung' })).toBeVisible();

  // Change a setting and put it back.
  const canvas = page.getByRole('group', { name: 'Hintergrund der freien Wand' });
  await canvas.getByRole('button', { name: 'Raster', exact: true }).click();
  await canvas.getByRole('button', { name: 'Punkte', exact: true }).click();

  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await expect(page).toHaveURL(board);
});

test('browser back leaves settings in one step', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  const board = page.url();

  await openSettingsFromRail(page);
  await page
    .getByRole('navigation', { name: 'Einstellungen' })
    .getByRole('link', { name: 'Wallybot', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: 'Wallybot' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(board);
});

test('phone: list, section, list, back to the board', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  const board = page.url();

  await page.getByRole('button', { name: 'Profil & Einstellungen', exact: true }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
  for (const name of ['Darstellung', 'Sprache', 'Wallybot', 'Verbundene Apps', 'Konto und Daten']) {
    await expect(page.getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
  }

  await page.getByRole('button', { name: /^Sprache/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Sprache' })).toBeVisible();
  await page.getByRole('button', { name: 'Zurück zu den Einstellungen', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Einstellungen' })).toBeVisible();
  await page.getByRole('button', { name: 'Zurück', exact: true }).click();
  await expect(page).toHaveURL(board);

  // CI runs with app connections off, which hides the setup fields; answer as production does
  // (as connections.spec.ts does) so the page shows its widest content.
  await page.route(/\/me\/connections$/, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        writesEnabled: true,
        client: { id: 'tpc_e2eClient', name: 'ChatGPT' },
        connections: [],
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 760 });
  await page.goto('/settings/connections');
  // Wait for the longest content (the copy fields), then check the scroller itself: the page
  // never scrolls sideways because the settings column is its own scroll container.
  await expect(page.getByLabel('Verbindungs-URL', { exact: true })).toBeVisible();
  expect(
    await page.locator('.settings-mobile').evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});
