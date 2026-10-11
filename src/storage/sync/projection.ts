import { parseSyncSnapshot, SYNC_SCHEMA_VERSION, type SyncAsset, type SyncSnapshotV1 } from '@/domain/sync';
import type { SyncRecordRow, SyncStateRow } from '@/storage/sync/types';

function liveKind<K extends SyncRecordRow['kind']>(rows: readonly SyncRecordRow[], kind: K) {
  return rows.filter((row): row is Extract<SyncRecordRow, { kind: K }> => row.kind === kind);
}

export function referencedSyncAssetIds(rows: readonly SyncRecordRow[]): ReadonlySet<string> {
  const settings = liveKind(rows, 'settings')[0];
  if (!settings) throw new Error('同步设置记录不完整');
  const ids = new Set<string>();
  const background = settings.value.appearance.value.background;
  if (background.kind === 'photo') ids.add(background.assetId);
  for (const row of liveKind(rows, 'shortcut')) {
    const icon = row.value.icon.value;
    if (icon.kind === 'asset') ids.add(icon.assetId);
  }
  return ids;
}

export function projectSyncSnapshot(input: {
  readonly state: SyncStateRow;
  readonly rows: readonly SyncRecordRow[];
  readonly assets: readonly SyncAsset[];
}): SyncSnapshotV1 {
  const { state, rows, assets } = input;
  const settings = liveKind(rows, 'settings')[0];
  if (!settings) throw new Error('同步设置记录不完整');
  return parseSyncSnapshot({
    schemaVersion: SYNC_SCHEMA_VERSION, vaultId: state.vaultId, deviceId: state.deviceId,
    generation: state.generation, defaultGroupId: state.defaultGroupId,
    groups: liveKind(rows, 'group').map((row) => row.value),
    shortcuts: liveKind(rows, 'shortcut').map((row) => row.value),
    settings: { ...settings.value, customEngines: liveKind(rows, 'custom-engine').map((row) => row.value) },
    assets, tombstones: rows.flatMap((row) => row.kind === 'tombstone' ? [row.tombstone] : []),
  });
}
