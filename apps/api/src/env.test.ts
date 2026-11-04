import { describe, expect, it } from 'vitest';
import { _resetEnvCacheForTests, loadEnv } from './env.js';
import { priceFor } from './lib/assistant/budget/prices.js';
import { AUTH0_AUDIENCE, AUTH0_ISSUER } from './lib/auth/constants.js';

describe('the assistant model defaults', () => {
  // Gemini 2.5 Flash is retired by Google on 2026-10-20; 3.8 Flash is served for this project
  // on the EU multi-region endpoint (`eu`), verified 2026-10-19 (the error handling spec).
  it('default to Gemini 3.8 Flash on the EU multi-region endpoint, with a price', () => {
    const env = loadEnv({
      DATABASE_URL: 'postgres://localhost/wally',
      CORS_ORIGIN: 'http://localhost',
    });
    expect(env.ASSISTANT_MODEL).toBe('vertex:gemini-3.8-flash');
    expect(env.ASSISTANT_VERTEX_LOCATION).toBe('eu');
    expect(priceFor(env.ASSISTANT_MODEL).outputMicroUsdPerToken).toBeGreaterThan(0);
  });
});

describe('the database connection', () => {
  it('is required', () => {
    _resetEnvCacheForTests();
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    _resetEnvCacheForTests();
  });
});

describe('the assistant project', () => {
  it('is required when the assistant is enabled', () => {
    _resetEnvCacheForTests();
    expect(() =>
      loadEnv({ DATABASE_URL: 'postgres://localhost/wally', ASSISTANT_ENABLED: 'true' }),
    ).toThrow(/ASSISTANT_VERTEX_PROJECT/);
    _resetEnvCacheForTests();
  });
  it('is not needed to boot without the assistant, and no Firebase setting exists', () => {
    _resetEnvCacheForTests();
    const env = loadEnv({ DATABASE_URL: 'postgres://localhost/wally' });
    expect(env).not.toHaveProperty('FIREBASE_PROJECT_ID');
    expect(env).not.toHaveProperty('AUTH0_ENABLED');
    _resetEnvCacheForTests();
  });
});

describe('local MCP transport configuration', () => {
  it('accepts a development process on a local database', () => {
    _resetEnvCacheForTests();
    expect(() =>
      loadEnv({
        DATABASE_URL: 'postgres://localhost/wally',
        NODE_ENV: 'development',
        MCP_LOCAL_URL: 'http://localhost:4502/mcp',
      }),
    ).not.toThrow();
    _resetEnvCacheForTests();
  });
  it.each([
    { NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/wally' },
    { NODE_ENV: 'test', DATABASE_URL: 'postgres://localhost/wally' },
    {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://u:p@db.abc.supabase.co:5432/postgres',
    },
  ])('rejects local configuration outside development on a local database: %j', (environment) => {
    _resetEnvCacheForTests();
    expect(() =>
      loadEnv({
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
        DATABASE_URL: 'postgres://localhost/wally',
        NODE_ENV: 'development',
        MCP_LOCAL_URL: url,
      }),
    ).toThrow();
    _resetEnvCacheForTests();
  });
});

describe('the fixed Auth0 values', () => {
  it('accepts AUTH0_ISSUER and AUTH0_AUDIENCE only with the values the API uses', () => {
    const base = { DATABASE_URL: 'postgres://localhost/wally' };
    _resetEnvCacheForTests();
    expect(() => loadEnv({ ...base, AUTH0_ISSUER, AUTH0_AUDIENCE })).not.toThrow();
    for (const other of [
      { AUTH0_ISSUER: 'https://evil.example/' },
      { AUTH0_AUDIENCE: 'https://api.example' },
      { AUTH0_ISSUER: '' },
    ]) {
      _resetEnvCacheForTests();
      expect(() => loadEnv({ ...base, ...other }), JSON.stringify(other)).toThrow();
    }
    _resetEnvCacheForTests();
  });
});

describe('the Auth0 Management settings', () => {
  const base = { DATABASE_URL: 'postgres://localhost/wally' };
  it('come as a pair', () => {
    _resetEnvCacheForTests();
    expect(() => loadEnv({ ...base, AUTH0_MANAGEMENT_CLIENT_ID: 'id' })).toThrow(
      /AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET/,
    );
    _resetEnvCacheForTests();
  });
  it('are not needed to load the configuration, even in production (migrations run without them)', () => {
    _resetEnvCacheForTests();
    expect(loadEnv({ ...base, NODE_ENV: 'production' }).AUTH0_MANAGEMENT_CLIENT_ID).toBeUndefined();
    _resetEnvCacheForTests();
  });
});
