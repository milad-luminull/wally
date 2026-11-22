import { test, expect } from '@playwright/test';
import { BOX_FIELD, captureNote, hasE2eCredentials, signIn } from './support';

test('creating a note from the top bar writes it through the Wally box', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  const title = `E2E note ${Date.now()}`;
  // Enter writes the note; no panel opens.
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

  // Tidy belongs to the assistant (RFC-0005-wallybot-inline.md §3.5): with it off, the horizon wall has
  // no bar under its bands, and a jotted note shows no destination.
  await expect(page.locator('[data-tidy-bar]')).toHaveCount(0);
  await expect(
    page.locator('[data-note-id]', { hasText: title }).locator('[data-tidy]'),
  ).toHaveCount(0);
});

test('with the assistant off, every message is a note, even one ending in a question mark', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  // With the assistant off, nothing is asked: the box shows no hint and Enter writes the note.
  const title = `E2E question ${Date.now()}?`;
  await page.getByRole('button', { name: 'Neue Notiz' }).first().click();
  const field = page.getByRole('textbox', { name: BOX_FIELD });
  await field.fill(title);
  await expect(page.getByText('Fragt Wally')).toHaveCount(0);
  await expect(page.getByText('Legt eine Notiz an')).toHaveCount(0);
  await field.press('Enter');
  await expect(field).toHaveValue('');

  await page.getByLabel('Notizen durchsuchen').fill(title);
  await expect(page.locator('[data-note-id]', { hasText: title })).toBeVisible();
});
