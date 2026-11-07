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

/**
 * Creates a note the way the top bar does now (RFC-0005-wallybot-inline.md §3.1): "Neue Notiz" puts
 * a capture card on the board, with no panel. Enter (or a blur) writes the note in place;
 * ⌘↵ / Ctrl+↵ writes it and opens its detail panel, which `open` asks for. Returns once the
 * card has given way to the note (and, with `open`, the panel is showing), so the card's
 * "Titel der neuen Notiz" field can no longer be mistaken for the panel's "Titel".
 */
export async function captureNote(page: Page, title: string, { open = false } = {}) {
  await page.getByRole('button', { name: 'Neue Notiz' }).click();
  const card = page.getByRole('group', { name: 'Neue Notiz schreiben' });
  const titleField = card.getByLabel('Titel der neuen Notiz', { exact: true });
  await titleField.fill(title);
  // The card takes Meta or Control with Enter; ControlOrMeta is Control on the Linux runner.
  await titleField.press(open ? 'ControlOrMeta+Enter' : 'Enter');
  await expect(card).toBeHidden();
  const panel = page.getByRole('complementary', { name: 'Notizdetails' });
  if (open) await expect(panel).toBeVisible();
  return panel;
}
