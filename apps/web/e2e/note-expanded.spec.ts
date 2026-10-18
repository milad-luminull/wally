import { test, expect } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

test('full-screen note keeps edits and returns to the board', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  const title = `Expanded note ${Date.now()}`;
  await captureNote(page, title);
  const card = page.locator('[data-note-id]').filter({ hasText: title });
  await card.hover();
  await card.getByRole('button', { name: 'Notiz im Vollbild öffnen' }).click();
  const panel = page.getByRole('complementary', { name: 'Notizdetails' });
  const viewport = page.viewportSize()!;
  await expect.poll(() => panel.boundingBox()).toEqual({ x: 0, y: 0, ...viewport });
  // Playwright's DOM role locator still matches inert descendants. Verify the actual
  // browser behavior instead: the covered search must refuse keyboard focus.
  const search = page.getByLabel('Notizen durchsuchen');
  await search.focus();
  await expect(search).not.toBeFocused();
  await expect(page.locator('.board-layout')).toHaveAttribute('inert', '');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/notes/') &&
      response.ok(),
  );
  await panel.getByLabel('Beschreibung', { exact: true }).fill('Keep this across presentations');
  await panel.getByRole('button', { name: 'In Seitenleiste öffnen' }).click();
  await expect(panel.getByLabel('Beschreibung', { exact: true })).toHaveValue(
    'Keep this across presentations',
  );
  await expect(page.locator('.board-layout')).not.toHaveAttribute('inert');
  await panel.getByRole('button', { name: 'Notiz im Vollbild öffnen' }).click();
  await panel.getByRole('button', { name: 'In Seitenleiste öffnen' }).press('Escape');
  await expect(panel.getByRole('button', { name: 'Notiz im Vollbild öffnen' })).toBeFocused();
  await saved;
  await page.reload();
  await expect(panel.getByLabel('Beschreibung', { exact: true })).toHaveValue(
    'Keep this across presentations',
  );
  await panel.getByRole('button', { name: 'Notiz im Vollbild öffnen' }).click();
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator('.board-layout')).not.toHaveAttribute('inert');
  await expect(page.getByLabel('Notizen durchsuchen')).toBeVisible();
});
