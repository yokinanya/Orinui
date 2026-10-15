import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { initializeSyncVault } from '@/storage/sync/vault';
import { createWebDavSyncLocal } from '@/storage/webdav-sync-local';

const cipher = createSyncCrypto(webcrypto as unknown as Crypto);
const databases: Database[] = [];
afterEach(async () => Promise.all(databases.splice(0).map((db) => db.delete())));

async function setup() {
  const db = createDatabase(`webdav-sync-local-${crypto.randomUUID()}`);
  databases.push(db);
  await ensureInitialized(db);
  const key = (await cipher.createKey()).key;
  await initializeSyncVault(db, { vaultId: 'vault-a', deviceId: 'device-a', key });
  return { db, key };
}

describe('createWebDavSyncLocal', () => {
  it.each([
    { vaultId: 'vault-a', deviceId: 'device-b' },
    { vaultId: 'vault-b', deviceId: 'device-a' },
  ])('rejects begin if the active identity differs from the bound identity', async (identity) => {
    const { db } = await setup();
    const before = await db.sync_state.get('app');
    const local = createWebDavSyncLocal({ db, identity,
      dependencies: { crypto: { hash: (bytes) => cipher.hash(bytes) }, validateStoredMediaAsset: async (asset) => asset } });
    await expect(local.begin({ runId: 'stale-run', startedAt: 10 })).rejects.toThrow('同步等待期间连接已变化');
    expect(await db.sync_state.get('app')).toEqual(before);
    expect((await db.sync_state.get('app'))?.lastSync).toBeUndefined();
  });
});
