import { describe, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';

// The privacy page lists who processes people's data. It has to name today's processors
// (docs/GDPR.md), never one Wally has retired.
describe.each([
  ['en', en.privacy.providers],
  ['de', de.privacy.providers],
])('the %s privacy provider list', (_language, providers) => {
  it('names the current processors', () => {
    for (const processor of ['Auth0', 'Supabase', 'Google', 'Cloudflare'])
      expect(providers).toContain(processor);
  });
  it('no longer names Firebase', () => {
    expect(providers).not.toMatch(/Firebase/);
  });
});
