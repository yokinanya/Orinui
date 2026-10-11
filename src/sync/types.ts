export type SyncPhase = 'reading' | 'merging' | 'receiving-media' | 'applying'
  | 'uploading-media' | 'publishing' | 'complete';

export type SyncPublication = 'not-started' | 'unconfirmed' | 'confirmed';

export interface SyncFailureInfo {
  readonly name: string;
  readonly message: string;
}

/** Local operational metadata, never part of a snapshot or ordinary backup. */
export interface SyncRunRecord {
  readonly runId: string;
  readonly status: 'running' | 'succeeded' | 'failed';
  readonly phase: SyncPhase;
  readonly publication: SyncPublication;
  readonly startedAt: number;
  readonly finishedAt?: number;
  readonly appliedAt?: number;
  readonly appliedGeneration?: number;
  readonly pendingEdits?: boolean;
  readonly error?: SyncFailureInfo;
}

export interface SyncSuccessRecord {
  readonly at: number;
  readonly generation: number;
  readonly revision: string;
}

export interface SyncRunResult {
  readonly runId: string;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly state: 'synced' | 'pending';
  readonly publishedGeneration: number;
  readonly localGeneration: number;
  readonly revision: string;
  readonly uploadedAssets: number;
  readonly downloadedAssets: number;
  readonly repairedAssetIds: readonly string[];
}
