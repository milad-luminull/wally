import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  FIREBASE_PROJECT_ID: z.string().min(1),
  // Optional so the API can boot against the Firestore emulator (and so the test suites
  // can run) without a service-account key. They are still required for real Firebase
  // ID-token verification — plugins/firebase.ts fails fast if they're missing there.
  FIREBASE_CLIENT_EMAIL: z.string().min(1).optional(),
  FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
  // Set by docker-compose to point the Admin SDK at the local Firestore emulator. The SDK
  // reads this variable itself; it's declared here so the config is visible and validated.
  FIRESTORE_EMULATOR_HOST: z.string().min(1).optional(),
  // Which Firestore database to use. Unset means "(default)", which is what the emulator
  // serves locally. Production sets this to `wally` — the EU (europe-west3) database —-
  // because the project's "(default)" database was auto-created in the US.
  FIRESTORE_DATABASE_ID: z.string().min(1).optional(),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/** Parses and validates process.env once, throwing with a readable message on failure. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only escape hatch so integration tests can reset the cache between suites. */
export function _resetEnvCacheForTests(): void {
  cached = undefined;
}
