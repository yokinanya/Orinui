import type { MediaAsset } from '@/domain/asset';
import type { SyncSnapshot } from '@/domain/sync';
import type { SyncCrypto, SyncObjectContext } from '@/platform/sync-crypto-types';
import type { SyncObjectStore } from '@/sync/objects';
import type { SyncFailureInfo, SyncPhase, SyncPublication } from '@/sync/types';

export interface SyncLocalExport {
  readonly snapshot: SyncSnapshot;
  readonly assets: readonly MediaAsset[];
  readonly localGeneration: number;
}

export interface SyncLocalPreview {
  readonly session: SyncSession;
  readonly local: SyncLocalExport;
}

export interface SyncSession {
  readonly vaultId: string;
  readonly deviceId: string;
  readonly key: CryptoKey;
  readonly hasBaseline: boolean;
}

export interface SyncRunIdentity {
  readonly runId: string;
  readonly vaultId: string;
  readonly deviceId: string;
}

export interface SyncLocalStore {
  readonly scope: string;
  begin(input: { readonly runId: string; readonly startedAt: number }): Promise<SyncSession>;
  preview(): Promise<SyncLocalPreview>;
  export(input: SyncRunIdentity): Promise<SyncLocalExport>;
  assertCurrent(input: SyncRunIdentity & { readonly expectedGeneration?: number }): Promise<void>;
  markPhase(input: SyncRunIdentity & { readonly phase: SyncPhase; readonly publication: SyncPublication }): Promise<void>;
  apply(input: SyncRunIdentity & { readonly snapshot: SyncSnapshot; readonly assets: readonly MediaAsset[];
    readonly expectedGeneration: number; readonly appliedAt: number }): Promise<void>;
  finish(input: SyncRunIdentity & { readonly publishedGeneration: number; readonly revision: string;
    readonly completedAt: number }): Promise<{ readonly localGeneration: number; readonly pendingEdits: boolean }>;
  /** false means this run no longer owns the current connection and must not change its state. */
  fail(input: SyncRunIdentity & { readonly phase: SyncPhase; readonly publication: SyncPublication;
    readonly error: SyncFailureInfo; readonly failedAt: number }): Promise<boolean>;
}

export interface SyncSizePreview {
  readonly measuredAt: number;
  readonly localMediaBytes: number;
  readonly remoteVaultBytes: number;
  readonly downloadMediaObjects: number;
  readonly downloadMediaBytes: number | null;
  readonly uploadMediaObjects: number;
  readonly uploadMediaBytes: number;
  readonly downloadSnapshotObjects: number;
  readonly downloadSnapshotBytes: number | null;
  readonly uploadSnapshotBytes: number;
}

export interface SyncLock {
  runExclusive<T>(scope: string, operation: () => Promise<T>): Promise<T>;
}

export interface SyncCodec {
  encode(snapshot: SyncSnapshot): Uint8Array;
  decode(bytes: Uint8Array, context: SyncObjectContext): SyncSnapshot;
  openImage(input: { readonly crypto: SyncCrypto; readonly key: CryptoKey; readonly vaultId: string;
    readonly asset: SyncSnapshot['assets'][number]; readonly ciphertext: Uint8Array }): Promise<MediaAsset>;
}

export interface SyncAlgorithms {
  merge(input: { readonly local: SyncSnapshot; readonly remotes: readonly SyncSnapshot[] }): SyncSnapshot;
  join(input: { readonly local: SyncSnapshot; readonly remotes: readonly SyncSnapshot[] }): SyncSnapshot;
}

export interface SyncCoordinatorDependencies {
  readonly local: SyncLocalStore;
  readonly objects: SyncObjectStore;
  readonly lock: SyncLock;
  readonly crypto: SyncCrypto;
  readonly codec: SyncCodec;
  readonly algorithms: SyncAlgorithms;
  readonly now: () => number;
  readonly createRunId: () => string;
  readonly reportProgress?: SyncProgressReporter;
}

export interface SyncTransferEvent {
  readonly phase: string;
  readonly objectId?: string;
  readonly completedBytes?: number;
  readonly totalBytes: number | undefined;
  readonly completedObjects?: number;
  readonly totalObjects?: number;
}

export type SyncProgressReporter = (progress: SyncTransferEvent) => void;
