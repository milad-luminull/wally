import { test, expect, type Page } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

/** Every board this spec creates carries this prefix, so a failed run can be cleaned up. */
const PREFIX = 'E2E ';

async function deleteFromHome(page: Page, name: string) {
  await page.getByRole('button', { name: `Optionen für ${name}` }).click();
  await page.getByRole('button', { name: 'Wand löschen' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Wand löschen' }).click();
  await expect(page.getByRole('link', { name: `${name} öffnen` })).toHaveCount(0);
}

// A board left behind by a failed run would make every other spec's sign-in land on the home.
test.afterEach(async ({ page }) => {
  if (!hasE2eCredentials) return;
  await page.goto('/boards');
  const leftovers = page.getByRole('link', { name: new RegExp(`^${PREFIX}.* öffnen$`) });
  for (const label of await leftovers.evaluateAll((links) =>
    links.map((link) => link.getAttribute('aria-label') ?? ''),
  ))
    await deleteFromHome(page, label.replace(/ öffnen$/, ''));
});

test('creating, landing on, and deleting a second board', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  const name = `${PREFIX}${Date.now()}`;

  await page.getByRole('button', { name: 'Wand wechseln' }).click();
  await page.getByRole('button', { name: 'Neue Wand' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Anlegen' }).click();
  await page.waitForURL(/\/boards\/.+/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

  await page.getByRole('link', { name: 'Zu deinen Wänden' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Deine Wände');
  await expect(page.getByRole('link', { name: /Weitermachen/ })).toContainText(name);

  await deleteFromHome(page, name);
});
