import type { SyncCrypto } from '@/platform/sync-crypto-types';
import type { SyncSnapshotV1 } from '@/domain/sync';
import type { Database } from '@/storage/db';
import { exportSyncSnapshot } from '@/storage/sync/export';
import { readSyncKey } from '@/storage/sync/vault';

export interface SealedSyncObject {
  readonly id: string;
  readonly ciphertext: Uint8Array;
}

export interface SealedSyncExport {
  readonly vaultId: string;
  readonly localGeneration: number;
  readonly snapshot: SealedSyncObject;
  readonly assets: readonly SealedSyncObject[];
}

/** Provider-independent encrypted objects; this does not upload or simulate a network success. */
export async function sealSyncExport(db: Database, dependencies: {
  readonly crypto: SyncCrypto;
  readonly encodeSnapshot: (snapshot: SyncSnapshotV1) => Uint8Array;
}): Promise<SealedSyncExport> {
  const { crypto } = dependencies;
  const prepared = await exportSyncSnapshot(db, crypto);
  const { snapshot } = prepared;
  const key = await readSyncKey(db, snapshot.vaultId);
  const sealedSnapshot = await crypto.encrypt({
    key, context: { vaultId: snapshot.vaultId, kind: 'snapshot', objectId: snapshot.deviceId },
    plaintext: dependencies.encodeSnapshot(snapshot),
  });
  const assets: SealedSyncObject[] = [];
  for (const asset of prepared.assets) {
    assets.push({ id: asset.id, ciphertext: await crypto.encrypt({
      key, context: { vaultId: snapshot.vaultId, kind: 'asset', objectId: asset.id },
      plaintext: new Uint8Array(await asset.blob.arrayBuffer()),
    }) });
  }
  return { vaultId: snapshot.vaultId, localGeneration: prepared.localGeneration,
    snapshot: { id: snapshot.deviceId, ciphertext: sealedSnapshot }, assets };
}
