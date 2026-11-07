import { test, expect } from '@playwright/test';

/**
 * The privacy policy and terms are static HTML (vite.config.ts), served at /privacy and
 * /terms by Cloudflare in production and by nginx in CI. They need no sign-in, so these specs
 * run without E2E credentials.
 */

// Google's OAuth branding review reads the served HTML without running JavaScript; the old
// client-rendered page reached it as an empty shell.
test('the legal pages carry their full text in the served HTML', async ({ request }) => {
  for (const [path, heading, phrase] of [
    ['/privacy', 'Privacy Policy', 'Limited Use requirements'],
    ['/terms', 'Terms of Service', 'Reporting illegal content'],
  ] as const) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['content-type'], path).toContain('text/html');
    const html = await response.text();
    expect(html, path).toContain(`<h1>${heading}</h1>`);
    expect(html, path).toContain(phrase);
    expect(html, path).not.toContain('id="root"');
  }
});

test('the landing page links to the privacy policy and the terms', async ({ page }) => {
  await page.goto('/');
  const footer = page.locator('footer');
  await footer.getByRole('link', { name: 'Datenschutzerklärung' }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible();

  await page.goto('/');
  await footer.getByRole('link', { name: 'Nutzungsbedingungen' }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeVisible();
});
