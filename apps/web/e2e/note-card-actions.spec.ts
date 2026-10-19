import { test, expect } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

test('card actions work with a collapsed sidebar and persist note changes', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  await page.goto(
    `${new URL(page.url()).pathname}?view=wand&axis=priority&done=1&mine=0&priority=&visibility=all`,
  );
  await page.getByRole('button', { name: 'Seitenleiste einklappen' }).click();
  const expandRail = page.getByRole('button', { name: 'Seitenleiste ausklappen' });
  await expect(expandRail).toBeFocused();
  await expect.poll(async () => (await page.locator('.board-rail').boundingBox())?.width).toBe(52);
  await page.getByRole('button', { name: 'Priorität', exact: true }).click();
  const title = `Card actions ${Date.now()}`;
  await captureNote(page, title);
  const card = page.locator('[data-note-id]').filter({ hasText: title });
  const more = card.getByRole('button', { name: 'Notizaktionen' });
  await card.hover();
  await more.click();
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
  const panel = page.getByRole('complementary', { name: 'Notizdetails' });
  await expect(panel).toBeVisible();
  await expect(card.locator('.paper-note')).toHaveAttribute('aria-current', 'true');
  await expect.poll(async () => (await panel.boundingBox())?.width).toBe(360);
  await card.hover();
  await more.click();
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
  await expect(panel.getByLabel('Titel', { exact: true })).toBeFocused();
  const colourSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/notes/') &&
      response.ok(),
  );
  await panel.getByRole('button', { name: 'Minze', exact: true }).click();
  await colourSaved;
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(card.locator('.paper-note')).not.toHaveAttribute('aria-current');
  const hideCompleted = page.getByRole('button', { name: 'Erledigte ausblenden', exact: true });
  await hideCompleted.click();
  await card.hover();
  await more.click();
  const doneSaved = page.waitForResponse(
    (response) => response.url().includes('/complete') && response.ok(),
  );
  await page.getByRole('button', { name: 'Als erledigt markieren' }).click();
  await doneSaved;
  await expect(card).toBeHidden();
  await expect(page.locator('[data-board-surface]')).toBeFocused();
  await hideCompleted.click();
  await page.goto(
    `${new URL(page.url()).pathname}?view=wand&axis=priority&done=1&visibility=shared`,
  );
  await card.hover();
  await more.click();
  await expect(page.getByRole('button', { name: 'Als offen markieren' })).toBeVisible();
  const privateSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().includes('/notes/') &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'Privat machen' }).click();
  await privateSaved;
  await expect(card).toBeHidden();
  await expect(page.locator('[data-board-surface]')).toBeFocused();
  await page.goto(`${new URL(page.url()).pathname}?view=wand&axis=priority&done=1&visibility=all`);
  await card.hover();
  await more.click();
  await expect(page.getByRole('button', { name: 'Privat machen' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Als offen markieren' })).toBeVisible();
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Minze', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await panel.getByRole('button', { name: 'Schließen', exact: true }).click();
  const preferencesSaved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname.endsWith('/me') &&
      response.ok(),
  );
  await page.getByRole('button', { name: 'Diese Woche', exact: true }).click();
  await preferencesSaved;
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Wally öffnen' })).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Anmelden', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Registrieren', exact: true })).toHaveCount(0);
});
