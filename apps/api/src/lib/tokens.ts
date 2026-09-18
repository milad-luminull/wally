import { randomBytes } from 'node:crypto';

/** A cryptographically random, URL-safe share-link token. */
export function generateShareToken(): string {
  return randomBytes(24).toString('base64url');
}
