import type { SyncObjectAddress, SyncSnapshotHead, SyncObjectRead, SyncAssetReceipt, SyncPublishReceipt } from '@/domain/sync/object-types';
export type { SyncObjectAddress, SyncSnapshotHead, SyncObjectRead, SyncAssetReceipt, SyncPublishReceipt } from '@/domain/sync/object-types';

/** WebDAV providers use atomic conditions except the explicit Nutstore readback mode. */
export interface SyncObjectStore {
  listSnapshots(input: { readonly vaultId: string }): Promise<readonly SyncSnapshotHead[]>;
  readSnapshot(input: SyncObjectAddress & { readonly revision: string }): Promise<SyncObjectRead>;
  readAsset(input: SyncObjectAddress): Promise<SyncObjectRead | null>;
  /** Create only when absent; Nutstore readback mode performs a pre-read and verifies the stored bytes. */
  createAsset(input: SyncObjectAddress & { readonly ciphertext: Uint8Array }): Promise<SyncAssetReceipt>;
  /** Nutstore compares SHA-256 before PUT and verifies after; concurrent same-device writes are not atomic. */
  publishSnapshot(input: SyncObjectAddress & {
    readonly expectedRevision: string | null;
    readonly ciphertext: Uint8Array;
  }): Promise<SyncPublishReceipt>;
}
