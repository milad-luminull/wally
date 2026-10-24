import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function indexesReady(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected))
    throw new Error('Invalid index inventory');
  for (const index of actual) {
    if (!['READY', 'CREATING', 'NEEDS_REPAIR'].includes(index.state))
      throw new Error('Unknown index state');
    if (index.state === 'NEEDS_REPAIR') throw new Error('Index requires repair');
  }
  return (
    actual.every((i) => i.state === 'READY') &&
    expected.every((wanted) =>
      actual.some((index) => {
        const group = index.name?.split('/collectionGroups/')[1]?.split('/')[0];
        const fields = index.fields?.filter(
          (f) =>
            f.fieldPath !== '__name__' || wanted.fields.some((w) => w.fieldPath === '__name__'),
        );
        return (
          group === wanted.collectionGroup &&
          index.queryScope === wanted.queryScope &&
          JSON.stringify(fields) === JSON.stringify(wanted.fields)
        );
      }),
    )
  );
}
export async function waitForIndexes({
  read,
  expected,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  attempts = 60,
}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (indexesReady(await read(), expected)) return;
    if (attempt + 1 < attempts) await sleep(20_000);
  }
  throw new Error('Expected composite indexes not READY after polling');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (!process.env.GCP_PROJECT_ID) throw new Error('Missing GCP_PROJECT_ID');
    const expected = JSON.parse(readFileSync('firestore.indexes.json', 'utf8')).indexes;
    await waitForIndexes({
      expected,
      read: () =>
        JSON.parse(
          execFileSync(
            'gcloud',
            [
              'firestore',
              'indexes',
              'composite',
              'list',
              '--database=wally',
              `--project=${process.env.GCP_PROJECT_ID}`,
              '--format=json',
            ],
            { encoding: 'utf8', timeout: 60_000 },
          ),
        ),
    });
    console.log('all indexes READY');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
