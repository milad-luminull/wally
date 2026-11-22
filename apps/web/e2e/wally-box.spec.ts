import { test, expect, type Page } from '@playwright/test';
import { BOX_FIELD, captureNote, hasE2eCredentials, signIn, stubAssistant } from './support';

/**
 * The Wally box (docs/superpowers/specs/2026-11-08-wally-box-design.md). CI runs with the
 * assistant off and no model, so the specs that need Wally stub the board's switch, the intake
 * and the question turn at the network: what they check is the box and the wall, not the model.
 */

/** Sends one message from the docked box and waits until the box is free again. */
async function send(page: Page, text: string) {
  await page.getByRole('button', { name: 'Neue Notiz' }).first().click();
  const field = page.getByRole('textbox', { name: BOX_FIELD });
  await field.fill(text);
  await field.press('Enter');
  await expect(field).toHaveValue('');
}

const box = (page: Page) => page.locator('[data-wally-box="docked"]');

test('one message becomes two notes', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  const stamp = Date.now();
  const first = `E2E dentist ${stamp}`;
  const second = `E2E budget ${stamp}`;
  await stubAssistant(page, {
    intake: () => ({
      items: [
        { kind: 'note', text: first },
        { kind: 'note', text: second },
      ],
      truncated: false,
    }),
  });
  await signIn(page);
  await send(page, `dentist thursday and ask tom about the budget ${stamp}`);
  await expect(page.locator('[data-note-id]', { hasText: first })).toHaveCount(1);
  await expect(page.locator('[data-note-id]', { hasText: second })).toHaveCount(1);
});

test('a question is answered in the box with the notes it read', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  const title = `E2E renewal ${Date.now()}`;
  const question = 'What is blocking the renewal?';
  await stubAssistant(page, {
    intake: (message) =>
      message === question
        ? { items: [{ kind: 'ask', text: question }], truncated: false }
        : { items: [{ kind: 'note', text: message }], truncated: false },
  });
  await signIn(page);
  await captureNote(page, title);
  const noteId = await page
    .locator('[data-note-id]', { hasText: title })
    .getAttribute('data-note-id');
  await page.route(/\/assistant\/turns$/, async (route) => {
    const boardId = new URL(route.request().url()).pathname.split('/')[2]!;
    await route.fulfill({
      json: {
        conversation: {
          id: 'e2e-conversation',
          boardId,
          status: 'OPEN',
          model: 'e2e',
          entries: [
            {
              role: 'user',
              text: question,
              chips: [],
              partial: false,
              stopped: null,
              at: new Date().toISOString(),
            },
            {
              role: 'assistant',
              text: 'The renewal waits on the offer.',
              chips: [{ id: noteId, title }],
              partial: false,
              stopped: null,
              at: new Date().toISOString(),
            },
          ],
        },
      },
    });
  });

  await send(page, question);
  await expect(box(page).getByText('The renewal waits on the offer.')).toBeVisible();
  await expect(box(page).getByText('Gelesene Notizen')).toBeVisible();
  await expect(box(page).getByRole('button', { name: new RegExp(title) })).toBeVisible();
  // Answers live in the box: nothing is drawn on the wall, and no note was written.
  await expect(page.locator('[data-ask-card]')).toHaveCount(0);
  await expect(page.locator('[data-note-id]', { hasText: question })).toHaveCount(0);
});

test('a duplicate asks first, and Add anyway adds it', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  const title = `E2E premium table ${Date.now()}`;
  let existing: { id: string; title: string } | null = null;
  await stubAssistant(page, {
    intake: (message) =>
      existing && message === title
        ? { items: [{ kind: 'duplicate', text: title, note: existing }], truncated: false }
        : { items: [{ kind: 'note', text: message }], truncated: false },
  });
  await signIn(page);
  await captureNote(page, title);
  const id = await page.locator('[data-note-id]', { hasText: title }).getAttribute('data-note-id');
  existing = { id: id!, title };

  await send(page, title);
  await expect(box(page).getByText(`Du hast schon „${title}“.`)).toBeVisible();
  await expect(page.locator('[data-note-id]', { hasText: title })).toHaveCount(1);
  await box(page).getByRole('button', { name: 'Trotzdem anlegen' }).click();
  await expect(page.locator('[data-note-id]', { hasText: title })).toHaveCount(2);
});

test('a double-click on the free wall opens the box there, and the note lands there', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  const board = new URL(page.url());
  board.searchParams.set('axis', 'free');
  await page.goto(board.toString());
  const canvas = page.getByTestId('wall-canvas');
  // Far from where notes are placed by default, so the double-click lands on empty wall.
  await canvas.evaluate((el) => el.scrollTo(1500, 1500));
  await canvas.dblclick({ position: { x: 240, y: 160 } });

  const anchored = page.locator('[data-wally-box="anchored"]');
  await expect(anchored).toBeVisible();
  await expect(box(page)).toBeHidden();
  const title = `E2E anchored ${Date.now()}`;
  const field = anchored.getByRole('textbox', { name: BOX_FIELD });
  await field.fill(title);
  await field.press('Enter');

  // The box goes back to the dock; the note stands where the wall was double-clicked.
  await expect(anchored).toHaveCount(0);
  await expect(box(page)).toBeVisible();
  const note = page.locator('[data-note-id]', { hasText: title });
  await expect(note).toBeVisible();
  const canvasBox = (await canvas.boundingBox())!;
  const noteBox = (await note.boundingBox())!;
  expect(Math.abs(noteBox.x - (canvasBox.x + 240))).toBeLessThan(4);
  expect(Math.abs(noteBox.y - (canvasBox.y + 160))).toBeLessThan(4);
});
