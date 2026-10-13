import type { Database } from '@/storage/db';
import { createSyncLocalStore } from '@/storage/sync/local-store';
import type { SyncApplyDependencies } from '@/storage/sync/apply-validation';
import type { SyncLocalStore } from '@/sync/ports';

export function createWebDavSyncLocal(input: { readonly db: Database; readonly dependencies: SyncApplyDependencies;
  readonly identity: { readonly vaultId: string; readonly deviceId: string } }): SyncLocalStore {
  const local = createSyncLocalStore(input.db, input.dependencies);
  return { ...local,
    begin: (run) => input.db.transaction('rw', input.db.sync_state, input.db.sync_keys, async () => {
      const state = await input.db.sync_state.get('app');
      if (!state || state.vaultId !== input.identity.vaultId || state.deviceId !== input.identity.deviceId) {
        throw new Error('同步等待期间连接已变化，旧连接不会访问新同步库');
      }
      return local.begin(run);
    }),
  };
}
