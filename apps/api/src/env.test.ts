import { describe, expect, it } from 'vitest';
import { _resetEnvCacheForTests, loadEnv } from './env.js';
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

describe('local MCP transport configuration', () => {
  it.each([
    { NODE_ENV: 'production', FIRESTORE_EMULATOR_HOST: undefined },
    { NODE_ENV: 'test', FIRESTORE_EMULATOR_HOST: 'firestore:8080' },
    { NODE_ENV: 'development', FIRESTORE_EMULATOR_HOST: undefined },
  ])('rejects local configuration outside a development emulator: %j', (environment) => {
    _resetEnvCacheForTests();
    expect(() =>
      loadEnv({
        FIREBASE_PROJECT_ID: 'p',
        MCP_LOCAL_URL: 'http://localhost:4502/mcp',
        ...environment,
      }),
    ).toThrow();
    _resetEnvCacheForTests();
  });
  it.each([
    'https://evil.example/mcp',
    'http://localhost:4502/other',
    'http://user@localhost:4502/mcp',
    'http://localhost:4502/mcp?x=1',
  ])('rejects unsafe local transport URL %s', (url) => {
    _resetEnvCacheForTests();
    expect(() =>
      loadEnv({
        FIREBASE_PROJECT_ID: 'p',
        NODE_ENV: 'development',
        FIRESTORE_EMULATOR_HOST: 'firestore:8080',
        MCP_LOCAL_URL: url,
      }),
    ).toThrow();
    _resetEnvCacheForTests();
  });
});
