exports.onExecutePostLogin = async (event, api) => {
  // An unverified address never gets a token, so it can never hold an address in Wally.
  // Runs on every login and refresh-token exchange, for every audience.
  if (event.user.email_verified !== true) {
    api.access.deny('EMAIL_NOT_VERIFIED');
    return;
  }
  // Supabase Third-Party Auth (ADR-0027) needs a literal `role` claim. Only the web app's
  // ID token gets it; access tokens never do, so Supabase runs them as `anon`. The client ID
  // comes from the Action secret WEB_CLIENT_ID; without it, no token gets the claim.
  const webClientId = event.secrets?.WEB_CLIENT_ID;
  if (webClientId && event.client?.client_id === webClientId)
    api.idToken.setCustomClaim('role', 'authenticated');
  const audience = event.resource_server?.identifier;
  if (
    audience !== 'https://api.wally.luminull.com' &&
    audience !== 'https://api.wally.luminull.com/mcp'
  )
    return;
  const ns = 'https://wally.luminull.com/';
  if (event.user.email) api.accessToken.setCustomClaim(`${ns}email`, event.user.email);
  api.accessToken.setCustomClaim(`${ns}email_verified`, event.user.email_verified === true);
  api.accessToken.setCustomClaim(`${ns}name`, event.user.name ?? null);
};
