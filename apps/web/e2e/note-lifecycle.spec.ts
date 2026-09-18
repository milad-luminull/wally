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

  await page.getByLabel('Teilschritt hinzufügen').fill('Erster Schritt');
  await page.getByLabel('Teilschritt hinzufügen').press('Enter');
  await expect(page.getByText('0 von 1')).toBeVisible();

  await page.getByRole('checkbox', { name: /als erledigt markieren/i }).click();
  await expect(page.getByText('1 von 1')).toBeVisible();

  await page.getByRole('button', { name: 'Erledigt' }).click();
  await expect(page.getByRole('button', { name: 'Wieder offen' })).toBeVisible();

  await page.getByRole('button', { name: 'Wieder offen' }).click();
  await expect(page.getByRole('button', { name: 'Erledigt' })).toBeVisible();

  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Löschen' }).click();

  await page.getByLabel('Notizen durchsuchen').fill(title);
  await expect(page.getByText('Keine Notiz passt zum Filter.')).toBeVisible();
});
