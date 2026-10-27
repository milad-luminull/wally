exports.onExecutePostLogin = async (event, api) => {
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
