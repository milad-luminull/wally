import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The legal pages are static HTML entries (vite.config.ts), served at /privacy and /terms.
// Their whole text has to be in the file itself: Google's OAuth branding review reads the
// served HTML without running the app, and rejected the old client-rendered page as empty.
const read = (file: string) => readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const privacy = read('privacy.html');
const terms = read('terms.html');

describe('the privacy policy', () => {
  // docs/GDPR.md §1 lists today's processors; the policy must name each, and no retired one.
  it('names the current processors', () => {
    for (const processor of ['Auth0', 'Supabase', 'Google Cloud', 'Cloudflare', 'Vertex AI'])
      expect(privacy).toContain(processor);
  });

  it('no longer names Firebase', () => {
    expect(privacy).not.toMatch(/Firebase/);
  });

  // Google's API Services User Data Policy asks for this disclosure, in these words.
  it('carries the Google Limited Use statement', () => {
    expect(privacy).toContain('Limited Use requirements');
    expect(privacy).toContain('https://developers.google.com/terms/api-services-user-data-policy');
  });

  it('states the retention periods from docs/GDPR.md', () => {
    for (const period of ['30 days after the invitation', '30 days after the last message'])
      expect(privacy).toContain(period);
  });
});

describe.each([
  ['privacy.html', privacy, 'Privacy Policy'],
  ['terms.html', terms, 'Terms of Service'],
])('%s', (_file, html, heading) => {
  it('renders its text without the app', () => {
    expect(html).toContain(`<h1>${heading}</h1>`);
    expect(html).not.toContain('id="root"');
    expect(html).not.toMatch(/<script[^>]+type="module"/);
  });

  it('names the operator and how to reach it', () => {
    expect(html).toContain('Luminull');
    expect(html).toContain('mailto:privacy@luminull.com');
  });

  it('links to both legal pages', () => {
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });
});
