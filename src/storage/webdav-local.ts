import type { Database } from '@/storage/db';
import { initializeSyncVault, disconnectSyncVault, readSyncKey } from '@/storage/sync/vault';
import type { WebDavLocalConnection } from '@/sync/webdav-types';

export function createWebDavLocalConnection(db: Database): WebDavLocalConnection {
  return {
    scope: db.name,
    read: () => db.sync_state.get('app'),
    readKey: (vaultId) => readSyncKey(db, vaultId),
    count: () => db.transaction('r', db.folders, db.shortcuts, db.assets, async () => ({
      folders: await db.folders.count(), shortcuts: await db.shortcuts.count(), assets: await db.assets.count(),
      assetBytes: (await db.assets.toArray()).reduce((total, asset) => total + asset.blob.size, 0),
    })),
    async initialize(input) { await initializeSyncVault(db, input); },
    disconnect: () => disconnectSyncVault(db),
  };
}
