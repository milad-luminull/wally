import { ManagementClient } from 'auth0';
import { AUTH0_TENANT_DOMAIN } from './constants.js';

/** Deletes a user in Auth0. Account deletion's only call to Auth0 (lib/account/erase.ts). */
export interface Auth0UserDeleter {
  deleteUser(subject: string): Promise<void>;
}

/**
 * A deleter on Auth0's Node SDK, for the machine-to-machine client allowed only
 * `delete:users`. The SDK gets the client-credentials token for `https://<tenant>/api/v2/`,
 * keeps it until shortly before it expires, and retries 408, 429 and 5xx answers.
 */
export function createAuth0UserDeleter(options: {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}): Auth0UserDeleter {
  const management = new ManagementClient({
    domain: AUTH0_TENANT_DOMAIN,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    timeoutInSeconds: 10,
    ...(options.fetch && { fetch: options.fetch }),
  });
  return {
    async deleteUser(subject) {
      await management.users.delete(subject);
    },
  };
}
