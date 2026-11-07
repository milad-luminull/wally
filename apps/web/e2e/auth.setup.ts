import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { test as setup } from '@playwright/test';
import { STORAGE_STATE, completeSignIn, hasE2eCredentials } from './support';

/**
 * Signs in once through Auth0's hosted page and saves the browser state, so the specs in
 * the projects that depend on `setup` start signed in (playwright.config.ts). The app keeps
 * its tokens in memory; what restores the session on each page load is Auth0's session
 * cookie on login.luminull.com, which this state carries. support.ts's signIn fails loudly
 * if a spec lands on /login anyway.
 *
 * The file holds that session cookie, so it lives outside test-results/ and
 * playwright-report/ (CI uploads the report) and is gitignored.
 */
setup('sign in once and save the session', async ({ page }) => {
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  if (!hasE2eCredentials) {
    // Every spec skips without credentials; they still need a state file to start from.
    writeFileSync(STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }));
    setup.skip(true, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  }
  await page.goto('/login');
  await completeSignIn(page);
  await page.context().storageState({ path: STORAGE_STATE });
});
