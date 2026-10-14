import type { WebDavCredentials } from '@/domain/webdav';
import type { WebDavConfiguration, WebDavConsistencyMode } from '@/domain/webdav/configuration';
export type { WebDavConfiguration } from '@/domain/webdav/configuration';
import type { SyncStateRow } from '@/storage/sync/types';
import type { SyncCrypto } from '@/platform/sync-crypto-types';
import type { WebDavRemote } from '@/platform/webdav-store';
import type { SyncLock, SyncCodec } from '@/sync/ports';
import type { SyncObjectStore } from '@/sync/objects';
import type { SyncRunResult } from '@/sync/types';

export interface WebDavCounts {
  readonly groups: number;
  readonly shortcuts: number;
  readonly assets: number;
}

export interface WebDavConnectionPlan {
  readonly mode: 'create' | 'join';
  readonly consistencyMode: WebDavConsistencyMode;
  readonly url: string;
  readonly username: string;
  readonly recoveryKey?: string;
  readonly local: WebDavCounts;
  readonly remote: WebDavCounts;
}

export interface WebDavSyncStatus {
  readonly url: string;
  readonly username: string;
  readonly vaultId: string;
  readonly deviceId: string;
  readonly state: 'pending' | 'syncing' | 'synced' | 'error';
  readonly lastSuccessfulSyncAt?: number;
  readonly error?: string;
}

export interface WebDavLocalConnection {
  readonly scope: string;
  read(): Promise<SyncStateRow | undefined>;
  readKey(vaultId: string): Promise<CryptoKey>;
  count(): Promise<WebDavCounts>;
  initialize(input: { readonly vaultId: string; readonly deviceId: string; readonly key: CryptoKey }): Promise<void>;
  disconnect(): Promise<void>;
}

export interface WebDavConfigurationStore {
  read(): Promise<WebDavConfiguration | null>;
  write(value: WebDavConfiguration): Promise<void>;
  remove(): Promise<void>;
}

export interface WebDavPrepareInput {
  readonly credentials: WebDavCredentials;
  readonly consistencyMode: WebDavConsistencyMode;
  readonly recoveryKey?: string;
}

export interface WebDavConnectionDependencies {
  readonly local: WebDavLocalConnection;
  readonly settings: WebDavConfigurationStore;
  readonly crypto: SyncCrypto;
  readonly decodeSnapshot: SyncCodec['decode'];
  readonly lock: SyncLock;
  readonly requestPermission: (url: string) => Promise<void>;
  readonly checkPermission: (url: string) => Promise<void>;
  readonly remote: (credentials: WebDavCredentials, consistencyMode: WebDavConsistencyMode) => WebDavRemote;
  readonly synchronize: (objects: SyncObjectStore, identity: { readonly vaultId: string; readonly deviceId: string }) => Promise<SyncRunResult>;
  readonly createId: () => string;
}

export interface WebDavSyncService {
  read(): Promise<WebDavSyncStatus | null>;
  prepare(input: WebDavPrepareInput): Promise<WebDavConnectionPlan>;
  connect(): Promise<void>;
  cancelPlan(): void;
  syncNow(): Promise<SyncRunResult>;
  disconnect(): Promise<void>;
}
