import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';
import { priceFor } from './lib/assistant/budget/prices.js';

describe('the assistant model defaults', () => {
  // Gemini 2.5 Flash is retired by Google on 2026-10-20; 3.8 Flash is served for this project
  // on the EU multi-region endpoint (`eu`), verified 2026-10-19 (the error handling spec).
  it('default to Gemini 3.8 Flash on the EU multi-region endpoint, with a price', () => {
    const env = loadEnv({ FIREBASE_PROJECT_ID: 'p', CORS_ORIGIN: 'http://localhost' });
    expect(env.ASSISTANT_MODEL).toBe('vertex:gemini-3.8-flash');
    expect(env.ASSISTANT_VERTEX_LOCATION).toBe('eu');
    expect(priceFor(env.ASSISTANT_MODEL).outputMicroUsdPerToken).toBeGreaterThan(0);
  });
});
