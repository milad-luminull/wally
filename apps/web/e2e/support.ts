import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

export const EMAIL = process.env.E2E_USER_EMAIL ?? '';
const PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

export const hasE2eCredentials = Boolean(EMAIL && PASSWORD);

/**
 * Where auth.setup.ts saves the signed-in browser state. It holds the Auth0 session cookie, so
 * it stays out of test-results/ and playwright-report/, which CI uploads (.gitignore covers it).
 */
export const STORAGE_STATE = fileURLToPath(
  new URL('../playwright/.auth/state.json', import.meta.url),
);

/** Start from Wally's login page; sign in on Auth0's hosted page, never bypassing API verification. */
export async function completeSignIn(page: Page) {
  const appOrigin = new URL(page.url()).origin;
  await page.getByRole('button', { name: 'Weiter zur Anmeldung', exact: true }).click();
  await page.waitForURL((url) => url.origin === 'https://login.luminull.com');
  // Never submit CI credentials to an unexpected redirect destination.
  expect(new URL(page.url()).origin).toBe('https://login.luminull.com');
  await page.locator('input[name="username"]').fill(EMAIL);
  // Auth0's required marker is part of its label; target the inspected password field.
  const password = page.locator('input[name="password"][type="password"]');
  // With Identifier First (required for passkeys) the password is on a second screen.
  if (!(await password.isVisible())) {
    await page.getByRole('button', { name: /^(Continue|Weiter)$/ }).click();
  }
  await password.fill(PASSWORD);
  const passwordPage = page.url();
  await page.getByRole('button', { name: /^(Continue|Weiter)$/ }).click();
  const inApp = (url: URL) => url.origin === appOrigin && /^\/boards(?:\/|$)/.test(url.pathname);
  const onLogin = (url: URL) => url.origin === 'https://login.luminull.com';
  await page.waitForURL((url) => inApp(url) || (onLogin(url) && url.href !== passwordPage));
  const current = () => new URL(page.url());
  if (onLogin(current()) && !current().pathname.startsWith('/u/consent')) {
    // Passkey progressive enrollment after a password login: CI keeps the password path.
    // The label is Auth0's, read from the live enrollment page (2026-11-04).
    await page.getByRole('button', { name: 'Continue without passkeys' }).click();
    await page.waitForURL(
      (url) => inApp(url) || (onLogin(url) && url.pathname.startsWith('/u/consent')),
    );
  }
  if (onLogin(current())) {
    // Localhost requires interactive consent even for a first-party application.
    await page.getByRole('button', { name: /^(Accept|Akzeptieren|Zustimmen)$/ }).click();
  }
  // One board lands in it; several land on the board home (RFC-0002 §6).
  await page.waitForURL(/\/boards(\/[^/?#]+)?(\?.*)?$/);
}

/**
 * Opens the test account's first board. In a project that starts from auth.setup.ts's saved
 * state, the stored Auth0 session signs the app in on page load; landing on /login there is
 * a failure, never a reason to sign in again. Elsewhere it signs in through Auth0.
 */
export async function signIn(page: Page) {
  if (test.info().project.use.storageState) {
    await page.goto('/boards');
    const openBoard = page.getByRole('link', { name: 'Meine Wand öffnen' }).first();
    const path = () => new URL(page.url()).pathname;
    await expect
      .poll(
        async () => /^\/boards\/[^/]+/.test(path()) || path() === '/login' || openBoard.isVisible(),
      )
      .toBe(true);
    if (path() === '/login') {
      throw new Error('The saved Auth0 session did not sign the app in (see e2e/auth.setup.ts).');
    }
    if (path() === '/boards') {
      await openBoard.click();
      await page.waitForURL(/\/boards\/.+/);
    }
    return;
  }
  await page.goto('/login');
  await completeSignIn(page);
  if (new URL(page.url()).pathname === '/boards') {
    // boards.spec.ts may have a second board open in parallel. The first board is the one
    // provisioned for the test account, which every other spec works on.
    await page.getByRole('link', { name: 'Meine Wand öffnen' }).first().click();
    await page.waitForURL(/\/boards\/.+/);
  }
}

/** The Wally box's field, by its German name (the E2E user writes German). */
export const BOX_FIELD = 'Schreib eine Notiz oder frag Wally';

/**
 * Creates a note through the Wally box (docs/superpowers/specs/2026-11-08-wally-box-design.md):
 * "Neue Notiz" focuses the box at the bottom of the board, Enter writes the note and frees the
 * box at once; ⌘↵ / Ctrl+↵ writes it as a note whatever the hint says and opens its detail
 * panel, which `open` asks for. Returns once the note is saved (and, with `open`, the panel is
 * showing).
 */
export async function captureNote(page: Page, title: string, { open = false } = {}) {
  await page.getByRole('button', { name: 'Neue Notiz' }).first().click();
  const field = page.getByRole('textbox', { name: BOX_FIELD });
  await expect(field).toBeFocused();
  await field.fill(title);
  // Waited for by the request, not the card: a remembered filter may hide the note.
  const created = page.waitForResponse(
    (r) =>
      /\/whiteboards\/[^/]+\/notes$/.test(new URL(r.url()).pathname) &&
      r.request().method() === 'POST',
  );
  // ControlOrMeta is Control on the Linux runner.
  await field.press(open ? 'ControlOrMeta+Enter' : 'Enter');
  await expect(field).toHaveValue('');
  expect((await created).ok()).toBe(true);
  const panel = page.getByRole('complementary', { name: 'Notizdetails' });
  if (open) await expect(panel).toBeVisible();
  return panel;
}

/** A proposal as the API answers one, for the note the capture names. */
export function proposal(noteId: string, boardId: string) {
  return {
    id: `e2e-${noteId}`,
    boardId,
    noteId,
    status: 'PENDING',
    // Never behind the note: the board drops a proposal made for an older revision, and the
    // real note moves on with every write.
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
export type CaptureCall = { noteId: string; locked: string[] };

/**
 * CI runs with the assistant off and no model, so this stubs the board's switch and the
 * assistant's calls at the network: what a spec checks is the board, not the model. The
 * intake answers `intake(message)`, by default one note in the message's words.
 */
export async function stubAssistant(
  page: Page,
  {
    intake = (message: string) => ({ items: [{ kind: 'note', text: message }], truncated: false }),
  }: { intake?: (message: string) => unknown } = {},
): Promise<CaptureCall[]> {
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
  await page.route(/\/assistant\/intakes$/, async (route) => {
    const { message } = route.request().postDataJSON() as { message: string };
    await route.fulfill({ json: intake(message) });
  });
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
