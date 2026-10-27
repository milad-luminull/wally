import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Firestore } from 'firebase-admin/firestore';
import { INITIAL_BOARD_NAME, type Language, type Preferences } from '@wally/shared';
import type { UserDoc, WithId } from '../lib/db/types.js';
import {
  normalizeEmail,
  now,
  userLanguage,
  userPreferences,
  usersCol,
  whiteboardsCol,
  withId,
} from '../lib/db/collections.js';
import { activatePendingInvitesForEmail } from '../lib/members.js';
import { languageFromAcceptLanguage } from '../lib/language.js';
import { decodeJwt } from 'jose';
import type { AccessTokenVerifier } from '../lib/auth/auth0.js';
import { resolveIdentity, resolveOrCreateIdentity } from '../lib/auth/identities.js';
import { AppError } from '../lib/errors.js';

interface AuthPluginOptions {
  auth0Verifier?: AccessTokenVerifier;
  auth0Issuer: string;
  auth0SignupEnabled?: boolean;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  /**
   * Straight from the verified ID token, not the stored copy. Required before trusting
   * `email` for anything privilege-granting — see UserDoc.emailVerified and the share-link
   * redemption in lib/members.ts, which may only claim an invite keyed by an address the
   * caller has actually confirmed.
   */
  emailVerified: boolean;
  displayName: string | null;
  /**
   * The caller's stored UI language, read through userLanguage() so a profile written before
   * the field existed reads as the default rather than undefined. Sourced from the profile
   * ONLY — Accept-Language is consulted at provisioning and nowhere else, see
   * lib/language.ts.
   */
  language: Language;
  /** Read through userPreferences(), for the same reason as `language`. */
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

interface ProvisionResult {
  user: WithId<UserDoc>;
  /**
   * Whether this transaction actually wrote anything. The pending-invite sweep below is a
   * collection-group query — billed on every request even when it matches nothing — and it
   * is only ever *needed* at the two moments this flips true for a user record: its
   * creation, and emailVerified going false -> true. See the sweep's call site.
   */
  changed: boolean;
}

/**
 * Writes the user record and, for a brand-new identity only, their first whiteboard, in one
 * transaction, so a new user can't end up with one and not the other, and two concurrent first
 * requests can't both create a board. The first board shares the user's uid as its id; later
 * boards (board.create) get generated ids, and nothing reads meaning into the uid-keyed one
 * any more. A board the user deleted is never recreated here (RFC 0002 §12.3).
 */
async function provisionUser(
  db: Firestore,
  uid: string,
  email: string,
  displayName: string | null,
  emailVerified: boolean,
  /**
   * Off Accept-Language, and consulted ONLY when this transaction creates something. Named
   * `signupLanguage`, not `language`, so a future reader cannot mistake it for the user's
   * current preference — that lives on the profile and is changed only via PATCH /me.
   */
  signupLanguage: Language,
  allowCreate: boolean,
): Promise<ProvisionResult> {
  const userRef = usersCol(db).doc(uid);
  const boardRef = whiteboardsCol(db).doc(uid);

  return db.runTransaction(async (tx) => {
    const existing = withId(await tx.get(userRef));
    if (!existing && !allowCreate) {
      throw new AppError(403, 'IDENTITY_NOT_LINKED', 'Account migration is required');
    }
    // Read only for a new identity, and only so a leftover board under this uid (a user record
    // removed by hand) is kept rather than overwritten. That includes a tombstoned board still
    // being cleaned up: its notes still point at this id, so a fresh board here would show them
    // again. Such a user starts with no board and creates one from the home.
    const boardExists = existing ? true : (await tx.get(boardRef)).exists;
    const timestamp = now();
    let changed = false;

    const user: WithId<UserDoc> = existing
      ? { ...existing, email, displayName, emailVerified, updatedAt: timestamp }
      : {
          id: uid,
          email,
          displayName,
          emailVerified,
          language: signupLanguage,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

    if (!existing) {
      tx.set(userRef, {
        email,
        displayName,
        emailVerified,
        language: signupLanguage,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      changed = true;
    } else if (
      existing.email !== email ||
      existing.displayName !== displayName ||
      // Strict, not isEmailVerified(): a record written before this field existed carries no
      // value at all, so `undefined !== false` forces exactly one backfilling write. That
      // write is also the one sweep that recovers any invite the old code left stranded.
      existing.emailVerified !== emailVerified
    ) {
      // This field list is deliberately exhaustive rather than a spread of `user`. update()
      // merges only the paths it names, which is what preserves a stored `language` here —
      // swapping it for tx.set(userRef, user) would destroy the user's chosen language on
      // every Firebase profile change. `language` must never be added to this list either:
      // it is not sourced from the token.
      tx.update(userRef, { email, displayName, emailVerified, updatedAt: timestamp });
      changed = true;
    }

    if (!boardExists) {
      tx.set(boardRef, {
        name: INITIAL_BOARD_NAME[signupLanguage],
        ownerId: uid,
        revision: 1,
        memberRoles: {},
        shareLinkToken: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      changed = true;
    }

    return { user, changed };
  });
}

/**
 * Global auth preHandler. Verifies the bearer token via the injectable
 * `fastify.authVerifier` (see plugins/firebase.ts), then makes sure the local user record
 * exists (with a first whiteboard for a brand-new identity), and auto-activates any pending
 * invite addressed to their email.
 *
 * The steady-state path is one document read, no writes and no collection-group query:
 * provisioning only runs on a user's first request or when their Firebase profile has
 * actually changed, and the pending-invite sweep only runs when provisioning wrote.
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

      // Unverified issuer selects a verifier only. No claim is trusted until verification.
      let isAuth0 = false;
      try {
        isAuth0 = decodeJwt(token).iss === options.auth0Issuer;
      } catch {
        /* Firebase rejects malformed tokens. */
      }
      let decoded;
      let externalIdentity;
      try {
        if (isAuth0) {
          if (!options.auth0Verifier) throw new Error('Auth0 is disabled');
          externalIdentity = await options.auth0Verifier.verify(token);
          decoded = {
            uid: '',
            email: externalIdentity.email,
            emailVerified: externalIdentity.emailVerified,
            name: externalIdentity.name,
          };
        } else {
          decoded = await fastify.authVerifier.verifyIdToken(token);
        }
      } catch {
        return reply
          .code(401)
          .send({ error: 'UNAUTHORIZED', message: 'Invalid token', retryable: false });
      }

      if (!decoded.email) {
        return reply
          .code(401)
          .send({ error: 'UNAUTHORIZED', message: 'Token has no email', retryable: false });
      }

      const db = fastify.db;
      let identityCreated = false;
      if (externalIdentity) {
        if (options.auth0SignupEnabled) {
          const resolved = await resolveOrCreateIdentity(
            db,
            externalIdentity,
            languageFromAcceptLanguage(request.headers['accept-language']),
          );
          decoded.uid = resolved.userId;
          identityCreated = resolved.created;
        } else decoded.uid = await resolveIdentity(db, externalIdentity);
      }
      const email = normalizeEmail(decoded.email);
      const displayName = decoded.name ?? null;

      const userSnapshot = await usersCol(db).doc(decoded.uid).get();
      const emailVerified = decoded.emailVerified;
      const existing = withId(userSnapshot);
      // Imported mappings must never resurrect a deleted account or create an empty one.
      if (externalIdentity && !existing) {
        throw new AppError(403, 'IDENTITY_NOT_LINKED', 'Account migration is required');
      }

      // emailVerified MUST take part in this comparison. Without it, a user who verifies
      // later keeps a stale `false` on their record forever, and the pending invite waiting
      // on that flag could never activate. The strictness (rather than isEmailVerified) is
      // deliberate — see provisionUser.
      const upToDate =
        existing !== null &&
        existing.email === email &&
        existing.displayName === displayName &&
        existing.emailVerified === emailVerified;

      let user: WithId<UserDoc>;
      let provisioned = identityCreated;
      if (upToDate) {
        user = existing;
      } else {
        const result = await provisionUser(
          db,
          decoded.uid,
          email,
          displayName,
          emailVerified,
          languageFromAcceptLanguage(request.headers['accept-language']),
          !externalIdentity,
        );
        user = result.user;
        provisioned = provisioned || result.changed;
      }

      // Auto-activate any pending invite addressed to this email, on any whiteboard —
      // but only once Firebase confirms this user actually controls the address. Firebase
      // allows sign-up with an unverified email, so skipping this check would let anyone
      // claim someone else's pending invite just by typing in their email at signup,
      // with no access to that inbox at all.
      //
      // `provisioned` narrows it further: upsertInvite links an invite addressed to a
      // VERIFIED existing user straight to an ACTIVE row, so a PENDING row can only become
      // claimable at the two moments provisioning writes — the record's creation, and
      // emailVerified flipping false -> true. Outside those there is nothing to find, and
      // this is a collection-group query billed on every single authenticated request.
      if (emailVerified && provisioned) {
        await activatePendingInvitesForEmail(db, user.id, email);
      }

      request.user = {
        id: user.id,
        email: user.email,
        emailVerified,
        displayName: user.displayName,
        // userLanguage(), not user.language: on the up-to-date path `user` is the raw stored
        // document, whose language is absent for any account created before this field
        // existed. Reading it directly would decorate undefined and 500 GET /me.
        language: userLanguage(user),
        preferences: userPreferences(user),
      };
    });
  },
  { name: 'auth-plugin', dependencies: ['firestore-plugin', 'firebase-plugin'] },
);
