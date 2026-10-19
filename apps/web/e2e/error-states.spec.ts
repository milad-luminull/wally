import { test, expect, type Page } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

/**
 * What the person sees when something fails (docs/superpowers/specs/2026-10-19-error-handling-
 * design.md). CI runs with the assistant off and no model, so the board's switch and the AI
 * calls are stubbed at the network, as in capture-review.spec.ts.
 */

/** The board reads as having its assistant on; captures answer with `answer`. */
async function stubCaptures(page: Page, answer: () => { status: number; json: unknown }) {
  const calls: unknown[] = [];
  await page.route(/\/whiteboards\/[^/?]+(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), assistantEnabled: true } });
  });
  await page.route(/\/assistant\/suggestions\/pending/, (route) =>
    route.fulfill({ json: { suggestions: [] } }),
  );
  await page.route(/\/assistant\/captures$/, async (route) => {
    calls.push(route.request().postDataJSON());
    const { status, json } = answer();
    await route.fulfill({ status, json });
  });
  return calls;
}

test('a capture with nothing to add says so on the card, then the card is ordinary again', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await stubCaptures(page, () => ({ status: 200, json: { suggestion: null } }));
  await signIn(page);
  const title = `E2E nothing ${Date.now()}`;
  await captureNote(page, title);
  const card = page.locator('[data-note-id]', { hasText: title });
  await expect(card.getByText('Nichts zu ergänzen')).toBeVisible();
  await expect(card.getByText('Nichts zu ergänzen')).toBeHidden({ timeout: 5_000 });
});

test('a busy AI is said on the card, and Try again asks once more', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  const calls = await stubCaptures(page, () => ({
    status: 502,
    json: { error: 'ASSISTANT_PROVIDER_ERROR', message: 'x', retryable: true },
  }));
  await signIn(page);
  const title = `E2E busy ${Date.now()}`;
  await captureNote(page, title);
  const card = page.locator('[data-note-id]', { hasText: title });
  await expect(card.getByText('Gerade ausgelastet')).toBeVisible();
  await card.getByRole('button', { name: 'Erneut versuchen' }).click();
  await expect.poll(() => calls.length).toBe(2);
  await expect(card.getByText('Gerade ausgelastet')).toBeVisible();
});

test('notes that fail to load are said, never shown as an empty board', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await page.route(/\/whiteboards\/[^/]+\/notes(\?.*)?$/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 500,
          json: { error: 'INTERNAL_SERVER_ERROR', message: 'Unexpected error', retryable: true },
        })
      : route.fallback(),
  );
  await signIn(page);
  // The list query retries twice before it gives up.
  await expect(page.getByText('Konnte die Notizen nicht laden')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
});
