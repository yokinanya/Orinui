import type { SyncObjectAddress, SyncSnapshotHead, SyncObjectRead, SyncAssetReceipt, SyncPublishReceipt } from '@/domain/sync/object-types';
export type { SyncObjectAddress, SyncSnapshotHead, SyncObjectRead, SyncAssetReceipt, SyncPublishReceipt } from '@/domain/sync/object-types';

/** Provider implementations must expose real object operations and atomic preconditions. */
export interface SyncObjectStore {
  listSnapshots(input: { readonly vaultId: string }): Promise<readonly SyncSnapshotHead[]>;
  readSnapshot(input: SyncObjectAddress & { readonly revision: string }): Promise<SyncObjectRead>;
  readAsset(input: SyncObjectAddress): Promise<SyncObjectRead | null>;
  /** Create only when absent; an existing object is never overwritten. */
  createAsset(input: SyncObjectAddress & { readonly ciphertext: Uint8Array }): Promise<SyncAssetReceipt>;
  /** null means create only when absent; otherwise replace exactly the observed revision. */
  publishSnapshot(input: SyncObjectAddress & {
    readonly expectedRevision: string | null;
    readonly ciphertext: Uint8Array;
  }): Promise<SyncPublishReceipt>;
}
