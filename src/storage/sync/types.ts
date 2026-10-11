import type { ImageAsset } from '@/domain/asset';
import type { SearchEngine } from '@/domain/search-engines';
import type { SyncAsset, SyncEntityType, SyncGroup, SyncRegister, SyncSettings, SyncShortcut, SyncTombstone } from '@/domain/sync/types';
import type { SyncRunRecord, SyncSuccessRecord } from '@/sync/types';

export interface SyncStateRow {
  readonly id: 'app';
  readonly vaultId: string;
  readonly deviceId: string;
  readonly clock: number;
  readonly generation: number;
  readonly defaultGroupId: SyncRegister<string>;
  readonly suspended: boolean;
  readonly hasAcceptedSnapshot?: boolean;
  readonly lastSync?: SyncRunRecord;
  readonly lastSuccessfulSync?: SyncSuccessRecord;
}

type SyncRecordKind = SyncEntityType | 'settings';

interface SyncRecordBase<K extends SyncRecordKind, V> {
  readonly id: `${K}:${string}`;
  readonly kind: K;
  readonly entityId: string;
  readonly value: V;
  readonly pendingDeleteUntil?: number;
  readonly retainedAsset?: ImageAsset;
}

export type SyncEntityRecordRow =
  | SyncRecordBase<'group', SyncGroup>
  | SyncRecordBase<'shortcut', SyncShortcut>
  | (SyncRecordBase<'asset', Omit<SyncAsset, 'sha256'>> & { readonly sha256?: string })
  | SyncRecordBase<'settings', SyncSettings>
  | SyncRecordBase<'custom-engine', SyncRegister<SearchEngine>>;

export interface SyncKeyRow {
  readonly id: string;
  readonly key: CryptoKey;
}

export interface SyncTombstoneRecordRow {
  readonly id: `${SyncEntityType}:${string}`;
  readonly kind: 'tombstone';
  readonly entityId: string;
  readonly tombstone: SyncTombstone;
}

export type SyncRecordRow = SyncEntityRecordRow | SyncTombstoneRecordRow;
