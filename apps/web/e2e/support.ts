import { expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_USER_EMAIL ?? '';
const PASSWORD = process.env.E2E_USER_PASSWORD ?? '';

export const hasE2eCredentials = Boolean(EMAIL && PASSWORD);
const provider = process.env.E2E_AUTH_PROVIDER ?? 'firebase';
if (!['firebase', 'auth0'].includes(provider)) throw new Error('Invalid E2E_AUTH_PROVIDER');

/** Start from Wally's login page; use the real provider without bypassing API verification. */
export async function completeSignIn(page: Page) {
  const appOrigin = new URL(page.url()).origin;
  if (provider === 'auth0') {
    await page.getByRole('button', { name: 'Weiter zur Anmeldung', exact: true }).click();
    await page.waitForURL((url) => url.origin === 'https://login.luminull.com');
    // Never submit CI credentials to an unexpected redirect destination.
    expect(new URL(page.url()).origin).toBe('https://login.luminull.com');
    await page.locator('input[name="username"]').fill(EMAIL);
    // Auth0's required marker is part of its label; target the inspected password field.
    await page.locator('input[name="password"][type="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: /^(Continue|Weiter)$/ }).click();
    await page.waitForURL(
      (url) =>
        (url.origin === appOrigin && /^\/boards(?:\/|$)/.test(url.pathname)) ||
        (url.origin === 'https://login.luminull.com' && url.pathname.startsWith('/u/consent')),
    );
    if (new URL(page.url()).origin === 'https://login.luminull.com') {
      // Localhost requires interactive consent even for a first-party application.
      await page.getByRole('button', { name: /^(Accept|Akzeptieren|Zustimmen)$/ }).click();
    }
  } else {
    await page.getByLabel('E-Mail').fill(EMAIL);
    await page.getByLabel('Passwort').fill(PASSWORD);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  }
  // One board lands in it; several land on the board home (RFC BOARD_HOME §6).
  await page.waitForURL(/\/boards(\/[^/?#]+)?(\?.*)?$/);
}

export async function signIn(page: Page) {
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
 * Creates a note the way the top bar does now (RFC 0005-wallybot-inline.md §3.1): "Neue Notiz" puts
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
