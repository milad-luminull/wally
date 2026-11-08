import { test, expect } from '@playwright/test';
import { hasE2eCredentials, signIn } from './support';

/**
 * ChatGPT asks for an OAuth client ID, because Auth0's dynamic registration is off
 * (docs/AUTH0.md, "MCP client"). CI runs with MCP off, so the API's answer is stubbed with
 * MCP on and a client, the way production answers.
 */
test('the connections page shows the connector URL and the OAuth client ID', async ({ page }) => {
  test.skip(!hasE2eCredentials, 'E2E_USER_EMAIL / E2E_USER_PASSWORD not set — see e2e/README.md');
  await page.route(/\/me\/connections$/, (route) =>
    route.fulfill({
      json: {
        enabled: true,
        writesEnabled: true,
        client: { id: 'tpc_e2eClient', name: 'ChatGPT' },
        connections: [],
      },
    }),
  );
  await signIn(page);
  await page.goto('/settings/connections');

  await expect(page.getByLabel('Verbindungs-URL')).toHaveValue(/\/mcp$/);
  await expect(page.getByLabel('OAuth-Client-ID')).toHaveValue('tpc_e2eClient');
  await expect(page.getByText(/Lass das Client-Secret leer/)).toBeVisible();
});
