import { test, expect } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

test('full note lifecycle: create, add a subtask, complete, reopen, delete', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');

  await signIn(page);

  const title = `Lifecycle-Test ${Date.now()}`;
  await page.getByRole('button', { name: 'Neue Notiz' }).click();
  const titleField = page.getByLabel('Titel');
  await titleField.fill(title);
  await titleField.blur();

  await page.getByLabel('Unteraufgabe hinzufügen').fill('Erster Schritt');
  await page.getByLabel('Unteraufgabe hinzufügen').press('Enter');
  await expect(page.getByText('0 von 1')).toBeVisible();

  await page.getByRole('checkbox', { name: /als erledigt markieren/i }).click();
  await expect(page.getByText('1 von 1')).toBeVisible();

  // Completing a note is a checkbox, not a footer button — a filled button in the bottom
  // confirm slot labelled "Erledigt" read as "close the panel". `exact` matters: name
  // matching is substring by default, and the subtask checkbox above is called
  // "… als erledigt markieren".
  const noteDone = page.getByRole('checkbox', { name: 'Erledigt', exact: true });
  await noteDone.click();
  await expect(noteDone).toBeChecked();

  await noteDone.click();
  await expect(noteDone).not.toBeChecked();

  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();

  // The desktop project runs at 1280px, i.e. in the Wand view on the Horizont axis, where
  // an exhausted filter renders per-zone empty states rather than one global message.
  // Asserting the note itself is gone tests the deletion regardless of the active view.
  await page.getByLabel('Notizen durchsuchen').fill(title);
  await expect(page.getByText(title)).toHaveCount(0);
});
