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
