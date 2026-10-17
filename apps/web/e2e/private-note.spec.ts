import { test, expect } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

test('a note made private shows a lock and stays under "Nur private"', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  // The filter is saved through a debounced PATCH /me (preferencesQueue.ts). Start waiting for
  // that response before each click that changes it, so a reload or the next click cannot
  // race the save.
  const preferenceSaved = () =>
    page.waitForResponse(
      (r) => r.url().endsWith('/me') && r.request().method() === 'PATCH' && r.ok(),
    );

  // An aborted earlier run can leave "Nur private" remembered, which turns the New button into
  // "Neue private Notiz". Wait for the button in either form, so the saved view has loaded,
  // then switch the filter off before starting.
  await expect(page.getByRole('button', { name: /^Neue (private )?Notiz/ })).toBeVisible();
  const leftOn = page.getByRole('radio', { name: 'Nur private' });
  if ((await leftOn.isVisible()) && (await leftOn.getAttribute('aria-checked')) === 'true') {
    const cleared = preferenceSaved();
    await leftOn.click();
    await cleared;
    await expect(leftOn).toHaveAttribute('aria-checked', 'false');
  }

  const title = `E2E private ${Date.now()}`;
  const panel = await captureNote(page, title, { open: true });

  await page.getByRole('switch', { name: 'Privat' }).click();
  await expect(page.getByText('Jetzt privat. Nur du siehst diese Notiz.')).toBeVisible();

  // Scoped to the note panel: the toast on screen has its own "Schließen" button.
  await panel.getByRole('button', { name: 'Schließen' }).click();
  await expect(panel).toBeHidden();

  const onlyPrivate = page.getByRole('radio', { name: 'Nur private' });
  const saved = preferenceSaved();
  await onlyPrivate.click();
  await saved;
  await expect(page.getByText(title)).toBeVisible();
  await expect(
    page.locator('[data-note-id]', { hasText: title }).getByRole('img', { name: 'Private Notiz' }),
  ).toBeVisible();

  // Remembered per board, so it survives a reload.
  await page.reload();
  await expect(onlyPrivate).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText(title)).toBeVisible();

  // Leave the board's view as the other specs expect it. Awaiting the save keeps the shared
  // E2E board from being left filtered for later specs.
  const reset = preferenceSaved();
  await onlyPrivate.click();
  await reset;
  await expect(onlyPrivate).toHaveAttribute('aria-checked', 'false');
});
