import { test, expect } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

test('creating a note from the top bar writes it in place', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  const title = `E2E note ${Date.now()}`;
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

test('a title ending in a question mark is a plain note while the board has no assistant', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  // With the assistant off, nothing is asked: the hint never changes and Enter writes the note.
  const title = `E2E question ${Date.now()}?`;
  await page.getByRole('button', { name: 'Neue Notiz' }).click();
  const card = page.getByRole('group', { name: 'Neue Notiz schreiben' });
  await card.getByLabel('Titel der neuen Notiz', { exact: true }).fill(title);
  await expect(card.getByText('↵ anlegen · ⇧↵ Text · Esc verwerfen')).toBeVisible();
  await card.getByLabel('Titel der neuen Notiz', { exact: true }).press('Enter');
  await expect(card).toBeHidden();

  await expect(page.locator('[data-ask-card]')).toHaveCount(0);
  await page.getByLabel('Notizen durchsuchen').fill(title);
  await expect(page.locator('[data-note-id]', { hasText: title })).toBeVisible();
});
