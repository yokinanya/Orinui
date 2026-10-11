export { finalizePendingDeletes } from '@/storage/sync/pending-deletes';
export { seedSyncRecords } from '@/storage/sync/seed';
export { initializeSyncVault, disconnectSyncVault, readSyncState, readSyncKey } from '@/storage/sync/vault';
export { exportSyncSnapshot, type SyncExport } from '@/storage/sync/export';
export { sealSyncExport, type SealedSyncExport } from '@/storage/sync/encrypted';
export { planSyncJoin } from '@/storage/sync/join-plan';
export { applySyncSnapshot, type ApplySyncSnapshotInput } from '@/storage/sync/apply';
export { createSyncLocalStore } from '@/storage/sync/local-store';
export type { SyncStateRow, SyncRecordRow, SyncKeyRow } from '@/storage/sync/types';
