import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { z } from 'zod';

export interface VerifiedIdentity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  clientId?: string;
  scopes?: string[];
  issuedAt?: number;
}

export interface AccessTokenVerifier {
  verify(token: string): Promise<VerifiedIdentity>;
}

export interface Auth0Config {
  issuer: string;
  audience: string;
}

const namespace = 'https://wally.luminull.com/';
const claimsSchema = z.object({
  iss: z.string().url(),
  sub: z.string().min(1),
  [`${namespace}email`]: z.string().email(),
  [`${namespace}email_verified`]: z.boolean(),
  [`${namespace}name`]: z.string().nullable().optional(),
});

/** Only the configured issuer can supply keys; token headers never choose a URL. */
export function createAuth0Verifier(
  config: Auth0Config,
  keys: JWTVerifyGetKey = createRemoteJWKSet(new URL('.well-known/jwks.json', config.issuer)),
): AccessTokenVerifier {
  return {
    async verify(token) {
      const { payload } = await jwtVerify(token, keys, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'iat', 'exp'],
      });
      claimsSchema.parse(payload);
      return {
        issuer: payload.iss!,
        subject: payload.sub!,
        email: payload[`${namespace}email`] as string,
        emailVerified: payload[`${namespace}email_verified`] as boolean,
        name: (payload[`${namespace}name`] as string | null | undefined) ?? null,
        ...(typeof payload.azp === 'string' ? { clientId: payload.azp } : {}),
        ...(typeof payload.scope === 'string'
          ? { scopes: payload.scope.split(' ').filter(Boolean) }
          : {}),
        issuedAt: payload.iat,
      };
    },
  };
}
