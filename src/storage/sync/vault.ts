import type { SyncStateRow } from '@/storage/sync/types';
import type { Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { seedSyncRecords } from '@/storage/sync/capture';

const STATE_ID = 'app' as const;
const SYNC_AES_BITS = 256;

interface InitializeSyncVaultInput {
  readonly vaultId: string;
  readonly deviceId: string;
  readonly key: CryptoKey;
}

function validateConfiguration(input: InitializeSyncVaultInput): void {
  if (!input.vaultId.trim() || !input.deviceId.trim()) throw new Error('同步库与设备身份不完整');
  const algorithm = input.key.algorithm as AesKeyAlgorithm;
  if (input.key.type !== 'secret' || input.key.extractable || algorithm.name !== 'AES-GCM'
    || algorithm.length !== SYNC_AES_BITS || !input.key.usages.includes('encrypt')
    || !input.key.usages.includes('decrypt')) throw new Error('同步密钥需要不可导出的 AES-256-GCM');
}

/** Creates local sync metadata without changing existing domain IDs or contacting a provider. */
export async function initializeSyncVault(db: Database, input: InitializeSyncVaultInput): Promise<SyncStateRow> {
  validateConfiguration(input);
  await ensureInitialized(db);
  return db.transaction('rw', [db.folders, db.shortcuts, db.settings, db.assets,
    db.sync_state, db.sync_records, db.sync_keys], async () => {
      if (await db.sync_state.get(STATE_ID)) throw new Error('本机已经连接同步库');
      await db.sync_state.add({
        id: STATE_ID, vaultId: input.vaultId, deviceId: input.deviceId, clock: 0, generation: 0,
        suspended: false,
      });
      await db.sync_keys.add({ id: input.vaultId, key: input.key });
      return seedSyncRecords(db);
    });
}

export async function readSyncState(db: Database): Promise<SyncStateRow> {
  const state = await db.sync_state.get(STATE_ID);
  if (!state) throw new Error('本机尚未配置同步库');
  return state;
}

export async function readSyncKey(db: Database, vaultId: string): Promise<CryptoKey> {
  const row = await db.sync_keys.get(vaultId);
  if (!row) throw new Error('本机同步密钥不存在，需要恢复密钥');
  return row.key;
}

/** Disconnects only this device; domain data and the external storage are untouched. */
export async function disconnectSyncVault(db: Database): Promise<void> {
  await db.transaction('rw', db.sync_state, db.sync_records, db.sync_keys, async () => {
    await db.sync_state.clear();
    await db.sync_records.clear();
    await db.sync_keys.clear();
  });
}
