import { z } from 'zod';
import { AUTH0_AUDIENCE, AUTH0_ISSUER } from './lib/auth/constants.js';
import { isLocalDatabaseUrl } from './lib/db/local.js';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  // The PostgreSQL connection string. In production it goes through Supabase's transaction
  // pooler, which is why the client turns prepared statements off (lib/postgres/client.ts).
  DATABASE_URL: z.string().url(),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  AUTH0_SIGNUP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MCP_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  MCP_WRITES_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Local transport alias only. Auth0's registered MCP JWT audience stays canonical.
  MCP_LOCAL_URL: z.string().url().optional(),
  MCP_CLIENT_ID: z.string().min(1).optional(),
  // Fixed values (lib/auth/constants.ts), which the API uses directly. Still accepted here so
  // existing compose and release configuration keeps working, but only with exactly those
  // values: anything else fails at boot.
  AUTH0_ISSUER: z.literal(AUTH0_ISSUER).optional(),
  AUTH0_AUDIENCE: z.literal(AUTH0_AUDIENCE).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // The machine-to-machine client that deletes a deleted account's Auth0 user (only
  // `delete:users`). Both or neither. The production API refuses to start without them
  // (buildApp); the migration and maintenance commands do not need them. Without them,
  // account deletion skips Auth0 and logs that it did (local development and CI).
  AUTH0_MANAGEMENT_CLIENT_ID: z.string().min(1).optional(),
  AUTH0_MANAGEMENT_CLIENT_SECRET: z.string().min(1).optional(),
  // The assistant's deployment switch. Off by default: with it off, the board response
  // reports `assistantEnabled: false` and every assistant operation answers 404.
  ASSISTANT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // The deployment's model as `provider:model`; parsed by lib/assistant/model/config.ts.
  // The only provider is `vertex` (Gemini on Vertex); any other fails at boot.
  // The default is Gemini 3.8 Flash on the EU multi-region endpoint (location `eu`, below),
  // which keeps processing in the EU (D4). Gemini 2.5 Flash, the earlier default, is retired
  // by Google on 2026-10-20. Verified 2026-10-19 with free countTokens probes: 3.8/3.7/3.6
  // Flash answer on `eu` for this project and 404 in europe-west1/3/4.
  ASSISTANT_MODEL: z.string().min(3).default('vertex:gemini-3.8-flash'),
  // Vertex location and project for the deployment route: `eu` is the EU multi-region
  // endpoint (aiplatform.eu.rep.googleapis.com, which @ai-sdk/google-vertex builds for it). The
  // project is required when the assistant is on (checked in loadEnv); the release sets it to
  // the Google Cloud project. The Cloud Run service account needs roles/aiplatform.user.
  ASSISTANT_VERTEX_LOCATION: z.string().min(1).default('eu'),
  ASSISTANT_VERTEX_PROJECT: z.string().min(1).optional(),
  // Per-user daily cap, in tokens; and the deployment's monthly cap in
  // integer micro-USD, from the versioned price table. Starting points, chosen 2026-10-15.
  ASSISTANT_DAILY_CAP_TOKENS: z.coerce.number().int().positive().default(300_000),
  ASSISTANT_MONTHLY_CAP_MICRO_USD: z.coerce.number().int().positive().default(15_000_000),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

const modelEnvSchema = envSchema.pick({
  ASSISTANT_MODEL: true,
  ASSISTANT_VERTEX_LOCATION: true,
  ASSISTANT_VERTEX_PROJECT: true,
});
export type ModelEnv = z.infer<typeof modelEnvSchema> & { ASSISTANT_VERTEX_PROJECT: string };

/**
 * The model's settings alone, for a script that only calls the model (the eval scripts): no
 * database or sign-in settings are needed to score prompts.
 */
export function loadModelEnv(source: NodeJS.ProcessEnv = process.env): ModelEnv {
  const parsed = modelEnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const { ASSISTANT_VERTEX_PROJECT: project } = parsed.data;
  if (!project)
    throw new Error('Invalid environment configuration: ASSISTANT_VERTEX_PROJECT is required');
  return { ...parsed.data, ASSISTANT_VERTEX_PROJECT: project };
}

/** Parses and validates process.env once, throwing with a readable message on failure. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  if (parsed.data.ASSISTANT_ENABLED && !parsed.data.ASSISTANT_VERTEX_PROJECT)
    throw new Error(
      'Invalid environment configuration: ASSISTANT_VERTEX_PROJECT is required when ASSISTANT_ENABLED=true',
    );
  const management = [
    parsed.data.AUTH0_MANAGEMENT_CLIENT_ID,
    parsed.data.AUTH0_MANAGEMENT_CLIENT_SECRET,
  ].filter(Boolean).length;
  if (management === 1)
    throw new Error(
      'Invalid environment configuration: set AUTH0_MANAGEMENT_CLIENT_ID and AUTH0_MANAGEMENT_CLIENT_SECRET together',
    );
  if (parsed.data.MCP_LOCAL_URL) {
    const url = new URL(parsed.data.MCP_LOCAL_URL);
    if (
      parsed.data.NODE_ENV !== 'development' ||
      !isLocalDatabaseUrl(parsed.data.DATABASE_URL) ||
      url.protocol !== 'http:' ||
      url.hostname !== 'localhost' ||
      !url.port ||
      url.pathname !== '/mcp' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'MCP_LOCAL_URL requires a development process on a local database and an explicit http://localhost:PORT/mcp URL',
      );
  }

  cached = parsed.data;
  return cached;
}

/** Test-only escape hatch so integration tests can reset the cache between suites. */
export function _resetEnvCacheForTests(): void {
  cached = undefined;
}
