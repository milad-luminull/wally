import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * A new record id: 20 random alphanumeric characters, the shape Firestore's auto-ids had, so
 * every id schema and URL that accepted those still accepts these.
 */
export function newId(): string {
  let id = '';
  for (let i = 0; i < 20; i++) id += ALPHABET[randomInt(ALPHABET.length)];
  return id;
}
