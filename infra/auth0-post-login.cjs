exports.onExecutePostLogin = async (event, api) => {
  const audience = event.resource_server?.identifier;
  if (
    audience !== 'https://api.wally.luminull.com' &&
    audience !== 'https://api.wally.luminull.com/mcp'
  )
    return;
  const ns = 'https://wally.luminull.com/';
  // A refresh is never interactive authentication. Preserve the primary method's
  // original time on login/SSO; never substitute token issuance or an MFA timestamp.
  if (event.transaction?.protocol !== 'oauth2-refresh-token') {
    const times = (event.authentication?.methods ?? [])
      .filter((method) => ['pwd', 'federated'].includes(method.name))
      .map((method) => Date.parse(method.timestamp) / 1000)
      .filter(Number.isFinite);
    if (times.length) api.accessToken.setCustomClaim(`${ns}auth_time`, Math.max(...times));
  }
  if (event.user.email) api.accessToken.setCustomClaim(`${ns}email`, event.user.email);
  api.accessToken.setCustomClaim(`${ns}email_verified`, event.user.email_verified === true);
  api.accessToken.setCustomClaim(`${ns}name`, event.user.name ?? null);
};
