import { test, expect } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

/** Runs under the "mobile-list-only" Playwright project (playwright.config.ts), which
 * emulates an iPhone viewport — verifying SPEC §11 and the plan's reconciled decision:
 * below 1080px there is no Wand tab and no drag affordance anywhere, not just a visually
 * hidden one. */
test('mobile viewport shows list-only with no drag/canvas affordance', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  await expect(page.getByRole('button', { name: 'Wand' })).toHaveCount(0);
  await expect(page.getByText(/Notizen frei verschieben geht am Rechner/)).toBeVisible();

  // No draggable note card should exist on the page at all (WallView/DndContext never mounts).
  // Since slice 2 the list rows carry data-note-id too, so target dnd-kit's drag attributes.
  await expect(page.locator('[aria-roledescription="draggable"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Filter' }).click();
  // The sheet's heading, not getByText: the button just clicked is also labelled "Filter".
  await expect(page.getByRole('heading', { name: 'Filter' })).toBeVisible();
});
