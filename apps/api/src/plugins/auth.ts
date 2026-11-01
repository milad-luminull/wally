import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Language, Preferences } from '@wally/shared';
import type { UserRow } from '../lib/db/types.js';
import { normalizeEmail, userPreferences } from '../lib/db/records.js';
import type { Database } from '../lib/postgres/client.js';
import { withTransaction } from '../lib/postgres/transaction.js';
import { users } from '../lib/postgres/schema/index.js';
import { activatePendingInvitesForEmail } from '../lib/members.js';
import { languageFromAcceptLanguage } from '../lib/language.js';
import type { AccessTokenVerifier, VerifiedIdentity } from '../lib/auth/auth0.js';
import { resolveIdentity, resolveOrCreateIdentity } from '../lib/auth/identities.js';
import { AppError } from '../lib/errors.js';

interface AuthPluginOptions {
  /** Auth0's access-token verifier; tests inject a fake through buildApp. */
  verifier: AccessTokenVerifier;
  /** Whether an unknown identity may create a Wally account (AUTH0_SIGNUP_ENABLED). */
  signupEnabled: boolean;
  /** The id for an account created at signup; random unless a test names its users. */
  newUserId?: (identity: VerifiedIdentity) => string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  /**
   * Straight from the verified access token, not the stored copy. Required before trusting
   * `email` for anything privilege-granting — see the share-link
   * redemption in lib/members.ts, which may only claim an invite keyed by an address the
   * caller has actually confirmed.
   */
  emailVerified: boolean;
  displayName: string | null;
  /**
   * The caller's stored UI language. Sourced from the profile ONLY — Accept-Language is
   * consulted at provisioning and nowhere else, see lib/language.ts.
   */
  language: Language;
  /** Read through userPreferences(), which defaults and drops anything malformed. */
  preferences: Preferences;
}

declare module 'fastify' {
  interface FastifyContextConfig {
    authBoundary?: 'mcp' | 'public-metadata';
  }
  interface FastifyRequest {
    user: AuthenticatedUser;
  }
}

/** Routes that must work without a token (health checks). Matched on path only. */
const PUBLIC_PATHS = new Set<string>(['/health']);

interface SyncResult {
  user: UserRow;
  /**
   * Whether this transaction actually wrote anything. Together with account creation, this is
   * when the pending-invite sweep below is needed: emailVerified going false -> true. See the
   * sweep's call site.
   */
  changed: boolean;
}

/**
 * Brings the stored profile in line with the verified token. The account itself, and its
 * first whiteboard, are created only at signup (resolveOrCreateIdentity); this never creates
 * a user.
 */
async function syncProfile(
  db: Database,
  userId: string,
  email: string,
  displayName: string | null,
  emailVerified: boolean,
): Promise<SyncResult> {
  return withTransaction(db, async (tx) => {
    const [existing] = await tx.select().from(users).where(eq(users.id, userId));
    if (!existing) {
      throw new AppError(
        403,
        'IDENTITY_NOT_LINKED',
        'This sign-in is not linked to a Wally account',
      );
    }
    if (
      existing.email === email &&
      existing.displayName === displayName &&
      existing.emailVerified === emailVerified
    )
      return { user: existing, changed: false };
    // `language` is never part of this update: it is not sourced from the token, and only
    // PATCH /me changes it.
    const [user] = await tx
      .update(users)
      .set({ email, displayName, emailVerified, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return { user: user!, changed: true };
  });
}

/**
 * Global auth preHandler. Verifies the bearer token as an Auth0 access token, resolves the
 * identity to its Wally user through `auth_identities` (creating the account at signup, when
 * signup is on), keeps the stored profile in line with the token, and auto-activates any
 * pending invite addressed to their email.
 *
 * The steady-state path is the identity lookup plus one read and no writes: the profile is
 * only written when it actually changed, and the pending-invite sweep only runs when the
 * account was created or the profile written.
 */
export default fp(
  async function authPlugin(fastify: FastifyInstance, options: AuthPluginOptions) {
    fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
      const path = request.url.split('?')[0] ?? request.url;
      if (request.method === 'GET' && PUBLIC_PATHS.has(path)) return;
      if (
        request.routeOptions.config.authBoundary === 'mcp' ||
        (request.method === 'GET' && request.routeOptions.config.authBoundary === 'public-metadata')
      )
        return;

      const header = request.headers.authorization;
      if (!header || !header.startsWith('Bearer ')) {
        return reply
          .code(401)
          .send({ error: 'UNAUTHORIZED', message: 'Missing bearer token', retryable: false });
      }
      const token = header.slice('Bearer '.length).trim();
      if (!token) {
        return reply
          .code(401)
          .send({ error: 'UNAUTHORIZED', message: 'Missing bearer token', retryable: false });
      }

      let identity: VerifiedIdentity;
      try {
        identity = await options.verifier.verify(token);
      } catch {
        return reply
          .code(401)
          .send({ error: 'UNAUTHORIZED', message: 'Invalid token', retryable: false });
      }

      if (!identity.email) {
        return reply
          .code(401)
          .send({ error: 'UNAUTHORIZED', message: 'Token has no email', retryable: false });
      }

      const db = fastify.db;
      let userId: string;
      let created = false;
      if (options.signupEnabled) {
        const resolved = await resolveOrCreateIdentity(
          db,
          identity,
          languageFromAcceptLanguage(request.headers['accept-language']),
          options.newUserId,
        );
        userId = resolved.userId;
        created = resolved.created;
      } else userId = await resolveIdentity(db, identity);
      const email = normalizeEmail(identity.email);
      const displayName = identity.name ?? null;
      const emailVerified = identity.emailVerified;

      const [existing] = await db.select().from(users).where(eq(users.id, userId));
      // A linked identity whose user record is gone (removed by hand) is refused: it never
      // recreates that user or creates an empty one.
      if (!existing) {
        throw new AppError(
          403,
          'IDENTITY_NOT_LINKED',
          'This sign-in is not linked to a Wally account',
        );
      }

      // emailVerified MUST take part in this comparison. Without it, a user who verifies
      // later keeps a stale `false` on their record forever, and the pending invite waiting
      // on that flag could never activate.
      const upToDate =
        existing.email === email &&
        existing.displayName === displayName &&
        existing.emailVerified === emailVerified;

      let user: UserRow = existing;
      let wrote = created;
      if (!upToDate) {
        const result = await syncProfile(db, userId, email, displayName, emailVerified);
        user = result.user;
        wrote = wrote || result.changed;
      }

      // Auto-activate any pending invite addressed to this email, on any whiteboard —
      // but only once the sign-in provider confirms this user actually controls the address.
      // A password signup starts with an unverified email, so skipping this check would let
      // anyone claim someone else's pending invite just by typing in their email at signup,
      // with no access to that inbox at all.
      //
      // `wrote` narrows it further: upsertInvite links an invite addressed to a VERIFIED
      // existing user straight to an ACTIVE row, so a PENDING row can only become claimable
      // at the two moments this request writes — the account's creation, and emailVerified
      // flipping false -> true. Outside those there is nothing to find.
      if (emailVerified && wrote) {
        await activatePendingInvitesForEmail(db, user.id, email);
      }

      request.user = {
        id: user.id,
        email: user.email,
        emailVerified,
        displayName: user.displayName,
        language: user.language,
        preferences: userPreferences(user),
      };
    });
  },
  { name: 'auth-plugin', dependencies: ['postgres-plugin'] },
);
