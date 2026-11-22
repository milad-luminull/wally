import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const apiDir = fileURLToPath(new URL('..', import.meta.url));

/** Runs the API's entry point to its exit and returns the JSON lines it wrote. */
function runServer(env: Record<string, string>) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiDir,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 20_000,
  });
  const lines = `${result.stdout}${result.stderr}`
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { status: result.status, lines, raw: `${result.stdout}${result.stderr}` };
}

/** The API's startup failures are structured lines, not a bare console print. */
describe('the API process', () => {
  it('logs a failed start as one CRITICAL line and exits 1', () => {
    const { status, lines, raw } = runServer({});
    expect(status).toBe(1);
    expect(
      raw
        .split('\n')
        .filter(Boolean)
        .every((line) => line.startsWith('{')),
    ).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      severity: 'CRITICAL',
      message: 'API failed to start',
      err: { message: expect.stringContaining('DATABASE_URL') },
    });
  });

  it('logs a port it cannot listen on as one CRITICAL line and exits 1', async () => {
    const busy = createServer();
    await new Promise<void>((resolve) => busy.listen(0, '0.0.0.0', resolve));
    const port = (busy.address() as { port: number }).port;
    try {
      const { status, lines } = runServer({
        DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost/none',
        PORT: String(port),
      });
      expect(status).toBe(1);
      expect(lines.find((line) => line.severity === 'CRITICAL')).toMatchObject({
        message: 'API failed to listen',
        err: { code: 'EADDRINUSE' },
      });
    } finally {
      busy.close();
    }
  });
});
