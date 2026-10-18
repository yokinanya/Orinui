import type { S3Configuration, S3Credentials } from '@/domain/s3-configuration';
import type { WebDavCounts } from '@/sync/webdav-types';
import type { SyncRunResult } from '@/sync/types';
import type { SyncProgressReporter } from '@/sync/ports';
import type { SyncSizePreview } from '@/sync/ports';

export interface S3ConnectionPlan {
  readonly mode: 'create' | 'join';
  readonly endpoint: string;
  readonly bucket: string;
  readonly prefix: string;
  readonly recoveryKey?: string;
  readonly local: WebDavCounts;
  readonly remote: WebDavCounts;
  readonly remoteObjectBytes: number;
}

export interface S3SyncStatus {
  readonly endpoint: string;
  readonly bucket: string;
  readonly prefix: string;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly state: 'pending' | 'syncing' | 'synced' | 'error';
  readonly lastSuccessfulSyncAt?: number;
  readonly error?: string;
}

export interface S3ResetTarget {
  readonly configuration: S3Configuration;
  readonly vaultId: string;
  readonly descriptorRevision: string;
}

export interface S3SyncService {
  read(): Promise<S3SyncStatus | null>;
  prepare(input: { readonly credentials: S3Credentials; readonly recoveryKey?: string }): Promise<S3ConnectionPlan>;
  connect(reportProgress?: SyncProgressReporter): Promise<void>;
  cancelPlan(): void;
  syncNow(reportProgress?: SyncProgressReporter): Promise<SyncRunResult>;
  previewSizes(reportProgress?: SyncProgressReporter): Promise<SyncSizePreview>;
  disconnect(): Promise<void>;
  deleteRemote(): Promise<void>;
  resetRemote(target: S3ResetTarget): Promise<void>;
}
