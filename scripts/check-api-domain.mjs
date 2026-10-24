// Read-only production release guard. Values enter as environment data, never shell code.
import { execFileSync } from 'node:child_process';

function requireCheck(condition, message) {
  if (!condition) throw new Error(message);
}
function command(name, args) {
  return execFileSync(name, args, { encoding: 'utf8', timeout: 120_000 });
}
try {
  const {
    API_BASE_URL: api,
    WEB_ORIGIN: web,
    GCP_PROJECT_ID: project,
    GCP_REGION: region,
  } = process.env;
  requireCheck(
    api === 'https://api.wally.luminull.com',
    'API_BASE_URL must be exactly https://api.wally.luminull.com (no trailing slash)',
  );
  requireCheck(
    web === 'https://wally.luminull.com',
    'WEB_ORIGIN must be exactly https://wally.luminull.com (no trailing slash)',
  );
  requireCheck(project && region, 'GCP_PROJECT_ID and GCP_REGION are required');
  const mapping = JSON.parse(
    command('gcloud', [
      'beta',
      'run',
      'domain-mappings',
      'describe',
      '--domain=api.wally.luminull.com',
      `--project=${project}`,
      `--region=${region}`,
      '--format=json',
    ]),
  );
  requireCheck(
    mapping.metadata?.name === 'api.wally.luminull.com',
    'Unexpected domain mapping name',
  );
  requireCheck(
    mapping.spec?.routeName === 'wally-api' && mapping.status?.mappedRouteName === 'wally-api',
    'Domain mapping must point to wally-api',
  );
  requireCheck(
    mapping.status?.conditions?.some(
      (condition) => condition.type === 'Ready' && condition.status === 'True',
    ),
    'Domain mapping is not Ready',
  );
  requireCheck(
    mapping.metadata?.generation != null &&
      String(mapping.status?.observedGeneration) === String(mapping.metadata.generation),
    'Domain mapping readiness is stale',
  );

  // No redirects or insecure TLS: the canonical hostname itself must answer correctly.
  const curl = ['--silent', '--show-error', '--connect-timeout', '10', '--max-time', '30'];
  const health = JSON.parse(command('curl', [...curl, '--fail', `${api}/health`]));
  requireCheck(health.status === 'ok', 'Canonical API /health is not healthy');
  const code = command('curl', [
    ...curl,
    '-o',
    '/dev/null',
    '-w',
    '%{http_code}',
    `${api}/whiteboards`,
  ]);
  requireCheck(code === '401', 'Canonical API /whiteboards must return 401 without credentials');
  const headers = command('curl', [
    ...curl,
    '--fail',
    '-D',
    '-',
    '-o',
    '/dev/null',
    '-X',
    'OPTIONS',
    '-H',
    `Origin: ${web}`,
    '-H',
    'Access-Control-Request-Method: GET',
    '-H',
    'Access-Control-Request-Headers: authorization,content-type',
    `${api}/whiteboards`,
  ]);
  // Use the final block (curl may also print a proxy CONNECT response).
  const block = headers
    .trim()
    .split(/\r?\n\r?\n/)
    .at(-1);
  requireCheck(/^HTTP\/\S+ 2\d\d(?:\s|$)/.test(block), 'CORS preflight must return a 2xx status');
  const values = (name) =>
    block
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().startsWith(`${name}:`))
      .map((line) => line.slice(line.indexOf(':') + 1).trim());
  const origins = values('access-control-allow-origin');
  requireCheck(
    origins.length === 1 && origins[0] === web,
    'CORS origin must match WEB_ORIGIN exactly',
  );
  const methods = values('access-control-allow-methods')
    .join(',')
    .split(',')
    .map((value) => value.trim());
  const allowedHeaders = values('access-control-allow-headers')
    .join(',')
    .toLowerCase()
    .split(',')
    .map((value) => value.trim());
  requireCheck(methods.includes('GET'), 'CORS must allow GET');
  requireCheck(
    ['authorization', 'content-type'].every((header) => allowedHeaders.includes(header)),
    'CORS must allow authorization and content-type',
  );
  console.log('Canonical API domain mapping, health, authentication and CORS checks passed');
} catch (error) {
  console.error(`API domain check failed: ${error.message}`);
  process.exitCode = 1;
}
