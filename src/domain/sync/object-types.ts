export interface SyncObjectAddress {
  readonly vaultId: string;
  readonly objectId: string;
}

export interface SyncSnapshotHead {
  readonly deviceId: string;
  readonly revision: string;
  readonly ciphertextBytes?: number;
}

export interface SyncAssetHead {
  readonly revision: string;
  readonly ciphertextBytes: number | null;
}

export interface SyncByteProgress {
  (completedBytes: number, totalBytes: number | undefined): void;
}

export interface SyncObjectProgress {
  (objectsCompleted: number): void;
}

export interface SyncObjectRead {
  readonly revision: string;
  readonly ciphertext: Uint8Array;
}

export interface SyncAssetReceipt {
  readonly created: boolean;
  readonly revision: string;
}

export interface SyncPublishReceipt {
  readonly revision: string;
}
