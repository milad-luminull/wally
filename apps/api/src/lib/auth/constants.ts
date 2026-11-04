/**
 * The Auth0 values the API trusts. They are fixed, not configuration: a token from any other
 * issuer, or for any other audience, is refused. AUTH0_ISSUER and AUTH0_AUDIENCE are still
 * accepted as environment variables (env.ts), but only with exactly these values.
 */

/** The Auth0 custom domain that issues every token the API accepts. */
export const AUTH0_ISSUER = 'https://login.luminull.com/';
/** The REST API's JWT audience. */
export const AUTH0_AUDIENCE = 'https://api.wally.luminull.com';
/** The MCP endpoint's canonical resource, and its JWT audience. */
export const MCP_RESOURCE = 'https://api.wally.luminull.com/mcp';
/**
 * The Auth0 Management API's audience: the tenant's default domain, not the custom domain the
 * requests go to. Auth0 Dashboard > Applications > APIs > Auth0 Management API > Identifier.
 * login.luminull.com is a CNAME of this tenant and serves the same signing keys (2026-11-04).
 */
export const AUTH0_MANAGEMENT_AUDIENCE = 'https://dev-4tuhqfy0z1yepp5h.eu.auth0.com/api/v2/';
