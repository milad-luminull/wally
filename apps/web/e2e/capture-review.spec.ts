import { test, expect, type Page } from '@playwright/test';
import { captureNote, hasE2eCredentials, signIn } from './support';

/**
 * The review card of smarter capture (docs/superpowers/specs/2026-10-18-smarter-capture-design.md
 * §5). CI runs with the assistant off and no model, so the second test stubs the board's switch
 * and the capture and decision calls at the network: what it checks is the card, not the model.
 * Both Playwright projects run it, so the wall (desktop) and the list (phone width) are covered.
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
    baseRevision: 1,
    fields: {
      dueDate: { value: '2026-10-23', reason: 'Freitag' },
      priority: null,
      assignee: null,
      title: null,
      reference: null,
      subtasks: null,
      links: null,
      horizon: { value: 'DIESE_WOCHE', reason: 'diese Woche' },
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

async function stubAssistant(page: Page) {
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
    const { noteId } = route.request().postDataJSON() as { noteId: string };
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
