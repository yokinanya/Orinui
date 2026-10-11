import type { AppSettings } from '@/domain/settings';
import type { ImageAsset } from '@/domain/asset';
import type { Shortcut } from '@/domain/shortcut';
import type { SyncEntityType, SyncSnapshotV1, SyncTombstone } from '@/domain/sync';
import type { MaterializedSyncData } from '@/domain/sync';
import type { SyncEntityRecordRow, SyncRecordRow, SyncStateRow, SyncTombstoneRecordRow } from '@/storage/sync/types';
import { recordId } from '@/storage/sync/builders';
import { fail } from '@/domain/errors';

export interface AppliedRows {
  readonly groups: MaterializedSyncData['groups'];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly ImageAsset[];
  readonly records: readonly SyncRecordRow[];
  readonly defaultGroupId: SyncStateRow['defaultGroupId'];
}

function tombstoneRow(tombstone: SyncTombstone): SyncTombstoneRecordRow {
  return { id: recordId(tombstone.entityType, tombstone.id), kind: 'tombstone', entityId: tombstone.id, tombstone };
}

function tombstoneMap(snapshot: SyncSnapshotV1): ReadonlyMap<string, SyncTombstone> {
  return new Map(snapshot.tombstones.map((item) => [recordId(item.entityType, item.id), item]));
}

function pendingShortcuts(records: readonly SyncRecordRow[], tombstones: ReadonlyMap<string, SyncTombstone>, now: number): Map<string, Extract<SyncEntityRecordRow, { kind: 'shortcut' }>> {
  const pending = new Map<string, Extract<SyncEntityRecordRow, { kind: 'shortcut' }>>();
  for (const record of records) {
    if (record.kind !== 'shortcut' || record.pendingDeleteUntil === undefined) continue;
    if (tombstones.has(record.id)) continue;
    if (record.pendingDeleteUntil <= now) fail(`待撤销删除已到期，需先生成删除墓碑：${record.entityId}`);
    pending.set(record.entityId, record);
  }
  return pending;
}

function assertTombstonesRetained(records: readonly SyncRecordRow[], tombstones: ReadonlyMap<string, SyncTombstone>): void {
  for (const record of records) {
    if (record.kind === 'tombstone' && !tombstones.has(record.id)) fail(`同步合并结果缺少本地删除墓碑：${record.entityId}`);
  }
}

function activeAssetIds(shortcuts: readonly Shortcut[], settings: AppSettings): Set<string> {
  const ids = new Set(shortcuts.flatMap(({ icon }) => icon.kind === 'asset' ? [icon.assetId] : []));
  const background = settings.appearance.background;
  if (background.kind === 'photo') ids.add(background.assetId);
  return ids;
}

function pendingAssetIds(shortcuts: ReadonlyMap<string, Extract<SyncEntityRecordRow, { kind: 'shortcut' }>>): Set<string> {
  return new Set([...shortcuts.values()].flatMap(({ value }) => {
    const icon = value.icon.value;
    return icon.kind === 'asset' ? [icon.assetId] : [];
  }));
}

interface CreateLiveRecordsInput {
  readonly snapshot: SyncSnapshotV1;
  readonly pending: ReadonlyMap<string, Extract<SyncEntityRecordRow, { kind: 'shortcut' }>>;
  readonly allAssets: ReadonlyMap<string, ImageAsset>;
  readonly cachedAssetIds: ReadonlySet<string>;
}

function createLiveRecords({ snapshot, pending, allAssets, cachedAssetIds }: CreateLiveRecordsInput): SyncEntityRecordRow[] {
  const groups: SyncEntityRecordRow[] = snapshot.groups.map((value) => ({ id: recordId('group', value.id), kind: 'group', entityId: value.id, value }));
  const shortcuts: SyncEntityRecordRow[] = snapshot.shortcuts.map((value) => {
    const prior = pending.get(value.id);
    return { id: recordId('shortcut', value.id), kind: 'shortcut', entityId: value.id, value,
      ...(prior ? { pendingDeleteUntil: prior.pendingDeleteUntil } : {}) };
  });
  const assets: SyncEntityRecordRow[] = snapshot.assets.map((value) => {
    const { sha256, ...metadata } = value;
    const retainedAsset = cachedAssetIds.has(value.id) ? allAssets.get(value.id) : undefined;
    return { id: recordId('asset', value.id), kind: 'asset', entityId: value.id, value: metadata, sha256,
      ...(retainedAsset ? { retainedAsset } : {}) };
  });
  const settings: SyncEntityRecordRow = { id: recordId('settings', 'app'), kind: 'settings', entityId: 'app',
    value: { ...snapshot.settings, customEngines: [] } };
  const engines: SyncEntityRecordRow[] = snapshot.settings.customEngines.map((value) => ({
    id: recordId('custom-engine', value.value.id), kind: 'custom-engine', entityId: value.value.id, value,
  }));
  return [...groups, ...shortcuts, ...assets, settings, ...engines];
}

function createTombstoneRecords(snapshot: SyncSnapshotV1): SyncTombstoneRecordRow[] {
  return snapshot.tombstones.map(tombstoneRow);
}

export function buildAppliedRows(input: {
  readonly snapshot: SyncSnapshotV1;
  readonly materialized: MaterializedSyncData;
  readonly existingRecords: readonly SyncRecordRow[];
  readonly incomingAssets: ReadonlyMap<string, ImageAsset>;
  readonly now: number;
}): AppliedRows {
  const tombstones = tombstoneMap(input.snapshot);
  assertTombstonesRetained(input.existingRecords, tombstones);
  const pending = pendingShortcuts(input.existingRecords, tombstones, input.now);
  const incomingShortcutIds = new Set(input.snapshot.shortcuts.map(({ id }) => id));
  for (const id of pending.keys()) {
    if (!incomingShortcutIds.has(id) && !tombstones.has(recordId('shortcut', id))) fail(`同步快照缺少待撤销网站：${id}`);
  }
  const shortcuts = input.materialized.shortcuts.filter(({ id }) => !pending.has(id));
  const currentAssets = activeAssetIds(shortcuts, input.materialized.settings);
  const retainedIds = new Set([...pendingAssetIds(pending)].filter((id) => !currentAssets.has(id)));
  const liveRecords = createLiveRecords({ snapshot: input.snapshot, pending, allAssets: input.incomingAssets, cachedAssetIds: retainedIds });
  const records: SyncRecordRow[] = [...liveRecords, ...createTombstoneRecords(input.snapshot)];
  const assets = [...currentAssets].map((id) => {
    const asset = input.incomingAssets.get(id);
    if (!asset) fail(`同步图片内容缺失：${id}`);
    return asset;
  });
  return { groups: input.materialized.groups, shortcuts, settings: input.materialized.settings, assets, records,
    defaultGroupId: input.snapshot.defaultGroupId };
}
