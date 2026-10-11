export type SyncMergeConflictCode =
  | 'default-group-deleted'
  | 'custom-engine-deleted-while-default'
  | 'asset-deleted-while-referenced';

export class SyncMergeConflictError extends Error {
  override readonly name = 'SyncMergeConflictError';

  constructor(readonly code: SyncMergeConflictCode, readonly entityId: string) {
    super(`同步合并冲突 ${code}：${entityId}`);
  }
}
