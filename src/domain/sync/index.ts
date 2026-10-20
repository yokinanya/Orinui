export { materializeSyncSnapshot, type MaterializedSyncData } from '@/domain/sync/materialize';
export { mergeSyncSnapshots, type MergeSyncSnapshotsInput } from '@/domain/sync/merge';
export { SyncMergeConflictError, type SyncMergeConflictCode } from '@/domain/sync/conflicts';
export { parseSyncSnapshot } from '@/domain/sync/validate';
export { maximumSyncClock, nextSyncCounter } from '@/domain/sync/version';
export {
  LEGACY_SYNC_SCHEMA_VERSION,
  LEGACY_STYLE_SYNC_SCHEMA_VERSION,
  LEGACY_LAYOUT_SYNC_SCHEMA_VERSION,
  LEGACY_GROUP_SYNC_SCHEMA_VERSION,
  LEGACY_FOLDER_SYNC_SCHEMA_VERSION,
  LEGACY_SEARCH_CUSTOMIZATION_SCHEMA_VERSION,
  LEGACY_ENGINE_OVERRIDE_SYNC_SCHEMA_VERSION,
  PREVIOUS_SYNC_SCHEMA_VERSION,
  CURRENT_SYNC_SCHEMA_VERSION,
  SYNC_SCHEMA_VERSION,
  type SupportedSyncSchemaVersion,
  type SyncAsset,
  type SyncEntityType,
  type SyncFolder,
  type SyncRegister,
  type SyncSettings,
  type SyncShortcut,
  type SyncSnapshot,
  type SyncTombstone,
} from '@/domain/sync/types';
