import { test, expect, type Page } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

/**
 * The review card of smarter capture (docs/superpowers/specs/2026-10-18-smarter-capture-design.md
 * §5). CI runs with the assistant off and no model, so the second test stubs the board's switch
 * and the capture and decision calls at the network: what it checks is the card, not the model.
 * Only the desktop project runs it (the phone project runs mobile-list-only.spec.ts alone), so
 * these cover the wall; the list row's review and edit are covered by the unit tests.
 */

test('with the assistant off, a written note shows no review and stays checkable', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await signIn(page);
  const title = `E2E review off ${Date.now()}`;
  await captureNote(page, title);
  const note = page.locator('[data-note-id]', { hasText: title });
  await expect(note).toBeVisible();
  await expect(note.getByRole('list', { name: 'Vorgeschlagene Felder' })).toHaveCount(0);
  await expect(note.getByRole('button', { name: 'Behalten' })).toHaveCount(0);
});

/** A proposal as the API answers one, for the note the capture names. */
function proposal(noteId: string, boardId: string) {
  return {
    id: `e2e-${noteId}`,
    boardId,
    noteId,
    status: 'PENDING',
    // Never behind the note: the board drops a proposal made for an older revision, and the
    // real note moves on with every write (the capture's commit, an edit).
    baseRevision: 1_000_000,
    fields: {
      dueDate: { value: '2026-10-23', reason: 'Freitag' },
      priority: null,
      assignee: null,
      title: null,
      reference: null,
      subtasks: null,
      links: null,
      horizon: { value: 'THIS_WEEK', reason: 'diese Woche' },
      visibility: { value: 'PRIVATE', reason: 'persönlich' },
      tags: { items: ['ops', 'sales'], reason: 'Tags der Wand' },
      properties: null,
      description: null,
    },
    typed: [],
    kept: null,
    createdAt: new Date().toISOString(),
  };
}

/** Each capture call the board made, with what it locked. */
type CaptureCall = { noteId: string; locked: string[] };

async function stubAssistant(page: Page): Promise<CaptureCall[]> {
  const captures: CaptureCall[] = [];
  // The board reads as having its assistant on.
  await page.route(/\/whiteboards\/[^/?]+(\?.*)?$/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), assistantEnabled: true } });
  });
  await page.route(/\/assistant\/suggestions\/pending/, (route) =>
    route.fulfill({ json: { suggestions: [] } }),
  );
  await page.route(/\/assistant\/captures$/, async (route) => {
    const { noteId, locked } = route.request().postDataJSON() as CaptureCall;
    captures.push({ noteId, locked });
    const boardId = new URL(route.request().url()).pathname.split('/')[2]!;
    await route.fulfill({ json: { suggestion: proposal(noteId, boardId) } });
  });
  await page.route(/\/assistant\/suggestions\/[^/]+\/decision$/, async (route) => {
    const parts = new URL(route.request().url()).pathname.split('/');
    const id = parts[parts.length - 2]!;
    const noteId = id.replace(/^e2e-/, '');
    await route.fulfill({
      json: { suggestion: { ...proposal(noteId, parts[2]!), id, status: 'DISCARDED' } },
    });
  });
  return captures;
}

test('with a stubbed proposal, the note shows the rows and the footer, × and ↺ work, Undo discards', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await stubAssistant(page);
  await signIn(page);
  const title = `E2E review ${Date.now()}`;
  await captureNote(page, title);

  // Under review the note is one card inside the moving border, on the wall and in the list.
  const note = page.locator('[data-capture-card]', { hasText: title });
  const list = note.getByRole('list', { name: 'Vorgeschlagene Felder' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(5);
  await expect(list.getByText('Diese Woche')).toBeVisible();
  // Private is only ever taken by the person: it starts crossed out.
  await expect(
    list.getByRole('button', { name: 'Wieder aufnehmen: Privat Nur du siehst sie' }),
  ).toBeVisible();
  await expect(note.getByText(/Speichert in \d+ s|Pausiert/)).toBeVisible();

  await list.getByRole('button', { name: 'Weglassen: Tag ops' }).click();
  await expect(list.getByRole('button', { name: 'Wieder aufnehmen: Tag ops' })).toBeVisible();
  await list.getByRole('button', { name: 'Wieder aufnehmen: Tag ops' }).click();
  await expect(list.getByRole('button', { name: 'Weglassen: Tag ops' })).toBeVisible();

  await note.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(list).toHaveCount(0);
  await expect(note.getByRole('button', { name: 'Behalten' })).toHaveCount(0);
});

/** The smarter-capture spec, revision "editing the text asks again". */
test('an edit in place asks again with the new words locked, and the review comes back', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  const captures = await stubAssistant(page);
  await signIn(page);
  const title = `E2E edit ${Date.now()}`;
  await captureNote(page, title);
  const note = page.locator('[data-capture-card]', { hasText: title });
  await expect(note.getByRole('list', { name: 'Vorgeschlagene Felder' })).toBeVisible();

  // Under review one click on the title starts the edit, in the capture card's field.
  await note.getByText(title, { exact: true }).click();
  const editor = page.getByRole('group', { name: 'Notiz bearbeiten' });
  const field = editor.getByLabel('Titel der Notiz', { exact: true });
  await expect(field).toHaveValue(title);
  await field.press('End');
  await field.pressSequentially(' bitte');
  await field.press('Enter');
  await expect(editor).toBeHidden();

  await expect.poll(() => captures.length).toBe(2);
  expect(captures[1]!.locked).toEqual(expect.arrayContaining(['title', 'description', 'horizon']));
  const edited = page.locator('[data-capture-card]', { hasText: `${title} bitte` });
  await expect(edited.getByRole('list', { name: 'Vorgeschlagene Felder' })).toBeVisible();
});

test('an edit in the sidebar asks again and shows the result there as the card does', async ({
  page,
}) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  const captures = await stubAssistant(page);
  await signIn(page);
  const title = `E2E panel edit ${Date.now()}`;
  await captureNote(page, title);
  const review = page.locator('[data-capture-card]', { hasText: title });
  await expect(review.getByRole('list', { name: 'Vorgeschlagene Felder' })).toBeVisible();
  // Settled first, so a click on the card opens it.
  await review.getByRole('button', { name: 'Rückgängig' }).click();
  await expect(review).toHaveCount(0);

  await page
    .locator('[data-note-id]', { hasText: title })
    .getByText(title, { exact: true })
    .click();
  const panel = page.getByRole('complementary', { name: 'Notizdetails' });
  const field = panel.getByLabel('Titel', { exact: true });
  await field.click();
  await field.press('End');
  await field.pressSequentially(' bitte');
  await field.press('Enter');

  await expect.poll(() => captures.length).toBe(2);
  expect(captures[1]!.locked).toEqual(expect.arrayContaining(['title', 'description', 'horizon']));
  const inPanel = panel.locator('[data-pending-review]');
  await expect(inPanel.getByRole('list', { name: 'Vorgeschlagene Felder' })).toBeVisible();
  await expect(inPanel.getByRole('button', { name: 'Behalten' })).toBeVisible();
});
