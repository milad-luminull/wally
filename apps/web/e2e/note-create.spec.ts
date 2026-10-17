import { test, expect } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

test('creating a note from the top bar writes it in place', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  const title = `E2E-Notiz ${Date.now()}`;
  // Enter writes the note where the card stood; no panel opens.
  const panel = await captureNote(page, title);
  await expect(panel).toBeHidden();

  await page.getByLabel('Notizen durchsuchen').fill(title);
  await expect(page.getByText(title)).toBeVisible();
  // The capture turn has no model in CI, so the card never shows a dot; this pins that the AI
  // look is absent on a plain note.
  await expect(
    page.locator('[data-note-id]', { hasText: title }).locator('[data-pending]'),
  ).toHaveCount(0);

  // Opened with a click, a plain note has no review section: nothing was proposed, so the panel
  // shows no "From what you typed" or "Added by Wallybot" groups.
  await page.locator('[data-note-id]', { hasText: title }).click();
  await expect(page.getByRole('complementary', { name: 'Notizdetails' })).toBeVisible();
  await expect(page.locator('[data-pending-review]')).toHaveCount(0);
});
