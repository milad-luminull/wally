import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAuth0Verifier } from './auth0.js';

const issuer = 'https://login.luminull.com/';
const audience = 'https://api.wally.luminull.com';
const profile = {
  'https://wally.luminull.com/email': 'person@example.com',
  'https://wally.luminull.com/email_verified': true,
  'https://wally.luminull.com/name': 'Person',
};
let keys: Awaited<ReturnType<typeof generateKeyPair>>;
let verify: ReturnType<typeof createAuth0Verifier>;
beforeAll(async () => {
  keys = await generateKeyPair('RS256');
  verify = createAuth0Verifier(
    { issuer, audience },
    createLocalJWKSet({ keys: [await exportJWK(keys.publicKey)] }),
  );
});
async function token(
  options: {
    issuer?: string;
    audience?: string;
    expires?: number;
    claims?: Record<string, unknown>;
  } = {},
) {
  return new SignJWT(options.claims ?? profile)
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(options.issuer ?? issuer)
    .setAudience(options.audience ?? audience)
    .setSubject('auth0|known-user')
    .setIssuedAt()
    .setExpirationTime(options.expires ?? Math.floor(Date.now() / 1000) + 300)
    .sign(keys.privateKey);
}
describe('Auth0 access-token boundary', () => {
  it('returns only verified identity/profile claims', async () => {
    expect(await verify.verify(await token())).toMatchObject({
      issuer,
      subject: 'auth0|known-user',
      email: 'person@example.com',
      emailVerified: true,
      name: 'Person',
    });
  });
  it.each([
    { issuer: 'https://attacker.example/' },
    { audience: 'https://api.wally.luminull.com/mcp' },
    { audience: 'Ck830qbC3GVTQDL3W3ku4yRA43O1R5hp' },
    { expires: 1 },
    { claims: {} },
    { claims: { ...profile, 'https://wally.luminull.com/email_verified': 'true' } },
  ])('rejects an invalid token %j', async (options) => {
    await expect(verify.verify(await token(options))).rejects.toThrow();
  });
  it('rejects a forged signature', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT(profile)
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('auth0|known-user')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(other.privateKey);
    await expect(verify.verify(forged)).rejects.toThrow();
  });
  it('preserves false verification without granting invite privileges', async () => {
    const result = await verify.verify(
      await token({ claims: { ...profile, 'https://wally.luminull.com/email_verified': false } }),
    );
    expect(result.emailVerified).toBe(false);
  });
});
