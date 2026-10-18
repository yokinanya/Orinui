import type { SyncObjectAddress, SyncSnapshotHead, SyncObjectRead, SyncAssetHead, SyncAssetReceipt, SyncPublishReceipt, SyncByteProgress, SyncObjectProgress } from '@/domain/sync/object-types';
export type { SyncObjectAddress, SyncSnapshotHead, SyncObjectRead, SyncAssetHead, SyncAssetReceipt, SyncPublishReceipt, SyncByteProgress, SyncObjectProgress } from '@/domain/sync/object-types';

/** WebDAV providers use atomic conditions except the explicit Nutstore readback mode. */
export interface SyncObjectStore {
  listSnapshots(input: { readonly vaultId: string }): Promise<readonly SyncSnapshotHead[]>;
  readSnapshot(input: SyncObjectAddress & { readonly revision: string; readonly expectedCiphertextBytes?: number;
    readonly onProgress?: SyncByteProgress }): Promise<SyncObjectRead>;
  readAsset(input: SyncObjectAddress & { readonly expectedCiphertextBytes?: number; readonly onProgress?: SyncByteProgress }): Promise<SyncObjectRead | null>;
  statAsset(input: SyncObjectAddress): Promise<SyncAssetHead | null>;
  measureVaultBytes(input: { readonly vaultId: string; readonly onObjectProgress?: SyncObjectProgress }): Promise<number>;
  /** Create only when absent; Nutstore readback mode performs a pre-read and verifies the stored bytes. */
  createAsset(input: SyncObjectAddress & { readonly ciphertext: Uint8Array; readonly onProgress?: SyncByteProgress }): Promise<SyncAssetReceipt>;
  /** Nutstore compares SHA-256 before PUT and verifies after; concurrent same-device writes are not atomic. */
  publishSnapshot(input: SyncObjectAddress & {
    readonly expectedRevision: string | null;
    readonly ciphertext: Uint8Array;
  }): Promise<SyncPublishReceipt>;
}
