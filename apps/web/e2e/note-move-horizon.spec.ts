import { test, expect } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

test('moving a note to a different Horizon zone persists after reload', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Create a note in "Heute" via the top-bar button (lands in the default zone), then
  // move it to "Später" through the detail panel's Spalte control — exercising the same
  // POST /notes/:id/move the Wand canvas drag calls, without depending on pixel-perfect
  // drag coordinates in CI.
  const title = `Horizont-Test ${Date.now()}`;
  await captureNote(page, title, { open: true });

  // The Spalte control is a Radix single-select ToggleGroup, so its items expose
  // role="radio" (inside a radiogroup) — not role="button".
  await page.getByRole('radio', { name: 'Später' }).click();
  await page.getByRole('button', { name: 'Schließen' }).click();

  await page.reload();
  await page.getByLabel('Notizen durchsuchen').fill(title);
  await page.getByText(title).click();

  await expect(page.getByRole('radio', { name: 'Später' })).toHaveAttribute('data-state', 'on');
});
