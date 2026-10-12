import { QueryClient } from '@tanstack/react-query';
import { expect, it } from 'vitest';
import { makeNote } from '@/test/fixtures';
import { scopedQueryKeys } from '../queryKeys';
import { patchNoteCaches, restoreNoteCaches, snapshotNoteCaches } from './shared';

it('rolls back only its own fields without erasing another note or concurrent field edit', () => {
  const client = new QueryClient();
  const keys = scopedQueryKeys('alice');
  client.setQueryData(keys.notes('board'), [
    makeNote({ id: 'a', title: 'Original' }),
    makeNote({ id: 'b', title: 'Other' }),
  ]);
  const snapshot = snapshotNoteCaches(client, keys, 'board', 'a');
  patchNoteCaches(client, keys, 'board', 'a', { title: 'Failed' });
  snapshotNoteCaches(client, keys, 'board', 'a');
  patchNoteCaches(client, keys, 'board', 'a', { colour: 'ROSE' });
  patchNoteCaches(client, keys, 'board', 'b', { title: 'Changed elsewhere' });
  restoreNoteCaches(client, keys, 'board', 'a', snapshot);
  expect(client.getQueryData(keys.notes('board'))).toMatchObject([
    { id: 'a', title: 'Original', colour: 'ROSE' },
    { id: 'b', title: 'Changed elsewhere' },
  ]);
});
