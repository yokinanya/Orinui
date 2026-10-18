import { fail } from '@/domain/errors';
import { SyncMergeConflictError } from '@/domain/sync/conflicts';
import { parseSyncSnapshot } from '@/domain/sync/validate';
import type { SearchEngine } from '@/domain/search-engines';
import { SYNC_SCHEMA_VERSION, type SyncAsset, type SyncEntityType, type SyncFolder, type SyncRegister, type SyncSettings, type SyncShortcut, type SyncSnapshot, type SyncTombstone } from '@/domain/sync/types';

export interface MergeSyncSnapshotsInput {
  readonly local: SyncSnapshot;
  readonly remotes: readonly SyncSnapshot[];
}

function registerOrder(left: Pick<SyncRegister<unknown>, 'clock' | 'deviceId'>, right: Pick<SyncRegister<unknown>, 'clock' | 'deviceId'>): number {
  if (left.clock !== right.clock) return left.clock - right.clock;
  if (left.deviceId === right.deviceId) return 0;
  return left.deviceId < right.deviceId ? -1 : 1;
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function choose<T>(left: SyncRegister<T>, right: SyncRegister<T>): SyncRegister<T> {
  const order = registerOrder(left, right);
  if (order === 0 && JSON.stringify(left.value) !== JSON.stringify(right.value)) fail('同一字段逻辑版本包含不同内容');
  return order >= 0 ? left : right;
}

function mergeRecord<T extends { readonly id: string }>(records: readonly T[], merge: (left: T, right: T) => T): T[] {
  const result = new Map<string, T>();
  for (const record of records) {
    const current = result.get(record.id);
    result.set(record.id, current ? merge(current, record) : record);
  }
  return [...result.values()].sort((left, right) => compareText(left.id, right.id));
}

function mergeFolder(left: SyncFolder, right: SyncFolder): SyncFolder {
  return { id: left.id, name: choose(left.name, right.name), position: choose(left.position, right.position) };
}

function mergeShortcut(left: SyncShortcut, right: SyncShortcut): SyncShortcut {
  return { id: left.id, title: choose(left.title, right.title), url: choose(left.url, right.url),
    placement: choose(left.placement, right.placement), icon: choose(left.icon, right.icon) };
}

function mergeEngines(engines: readonly SyncRegister<SearchEngine>[]): SyncRegister<SearchEngine>[] {
  const engineMap = new Map<string, SyncRegister<SearchEngine>>();
  for (const engine of engines) {
    const id = engine.value.id;
    const current = engineMap.get(id);
    engineMap.set(id, current ? choose(current, engine) : engine);
  }
  return [...engineMap.values()].sort((left, right) => compareText(left.value.id, right.value.id));
}

function mergeSettings(snapshots: readonly SyncSnapshot[]): SyncSettings {
  const first = snapshots[0];
  if (!first) fail('同步快照不能为空');
  const customEngines = mergeEngines(snapshots.flatMap(({ settings }) => settings.customEngines));
  let merged: SyncSettings = { ...first.settings, customEngines };
  for (const snapshot of snapshots.slice(1)) {
    merged = {
      appearance: choose(merged.appearance, snapshot.settings.appearance),
      defaultEngineId: choose(merged.defaultEngineId, snapshot.settings.defaultEngineId),
      layout: choose(merged.layout, snapshot.settings.layout),
      clock: choose(merged.clock, snapshot.settings.clock),
      searchPreferences: choose(merged.searchPreferences, snapshot.settings.searchPreferences),
      shortcutPreferences: choose(merged.shortcutPreferences, snapshot.settings.shortcutPreferences),
      customEngines: mergeEngines([...merged.customEngines, ...snapshot.settings.customEngines]),
    };
  }
  return merged;
}

function mergeAsset(left: SyncAsset, right: SyncAsset): SyncAsset {
  if (left.kind !== right.kind || left.mime !== right.mime || left.width !== right.width || left.height !== right.height ||
    left.byteLength !== right.byteLength || left.sha256 !== right.sha256 || JSON.stringify(left.motion) !== JSON.stringify(right.motion)) {
    fail(`同一媒体标识对应不同内容：${left.id}`);
  }
  return { ...left, sourceUrl: choose(left.sourceUrl, right.sourceUrl), name: choose(left.name, right.name) };
}

function mergeAssets(snapshots: readonly SyncSnapshot[], tombstones: ReadonlySet<string>, references: ReadonlySet<string>): SyncAsset[] {
  const all = snapshots.flatMap(({ assets }) => assets);
  return mergeRecord(all, mergeAsset).filter((asset) => (asset.kind === 'background' || references.has(asset.id))
    && !tombstones.has(tombstoneKey('asset', asset.id)));
}

function referencedAssets(shortcuts: readonly SyncShortcut[], settings: SyncSettings): Set<string> {
  const references = new Set(shortcuts.flatMap(({ icon }) => icon.value.kind === 'asset' ? [icon.value.assetId] : []));
  const background = settings.appearance.value.background;
  if (background.kind === 'photo' || background.kind === 'motion') references.add(background.assetId);
  return references;
}

function assertReferencesAlive(input: {
  readonly settings: SyncSettings;
  readonly shortcuts: readonly SyncShortcut[];
  readonly tombstones: ReadonlySet<string>;
}): void {
  const { settings, shortcuts, tombstones } = input;
  const engineId = settings.defaultEngineId.value;
  if (tombstones.has(tombstoneKey('custom-engine', engineId))) {
    throw new SyncMergeConflictError('custom-engine-deleted-while-default', engineId);
  }
  for (const assetId of referencedAssets(shortcuts, settings)) {
    if (tombstones.has(tombstoneKey('asset', assetId))) {
      throw new SyncMergeConflictError('asset-deleted-while-referenced', assetId);
    }
  }
}

function tombstoneKey(type: SyncEntityType, id: string): string {
  return `${type}:${id}`;
}

function mergeTombstoneLists(lists: readonly (readonly SyncTombstone[])[]): SyncTombstone[] {
  const unique = new Map<string, SyncTombstone>();
  for (const tombstone of lists.flat()) {
    const key = tombstoneKey(tombstone.entityType, tombstone.id);
    const current = unique.get(key);
    if (!current || registerOrder(tombstone, current) > 0) unique.set(key, tombstone);
  }
  return [...unique.values()].sort((left, right) => compareText(left.entityType, right.entityType) || compareText(left.id, right.id));
}

function mergeTombstones(snapshots: readonly SyncSnapshot[]): SyncTombstone[] {
  return mergeTombstoneLists(snapshots.map(({ tombstones }) => tombstones));
}

function latestSnapshotPerDevice(snapshots: readonly SyncSnapshot[]): SyncSnapshot[] {
  const devices = new Map<string, SyncSnapshot>();
  for (const snapshot of snapshots) {
    const current = devices.get(snapshot.deviceId);
    if (current && current.vaultId !== snapshot.vaultId) fail('同一设备快照属于不同同步库');
    if (!current || snapshot.generation > current.generation) devices.set(snapshot.deviceId, snapshot);
    else if (snapshot.generation === current.generation && JSON.stringify(snapshot) !== JSON.stringify(current)) fail('同一设备代次存在冲突快照');
  }
  return [...devices.values()].sort((left, right) => compareText(left.deviceId, right.deviceId));
}

export function mergeSyncSnapshots({ local, remotes }: MergeSyncSnapshotsInput): SyncSnapshot {
  const snapshots = latestSnapshotPerDevice([parseSyncSnapshot(local), ...remotes.map(parseSyncSnapshot)]);
  const first = snapshots[0];
  if (!first) fail('同步快照不能为空');
  if (snapshots.some(({ vaultId }) => vaultId !== first.vaultId)) fail('无法合并不同步库的数据');

  const allTombstones = mergeTombstones(snapshots);
  const shortcutTombstones = new Set(allTombstones
    .filter(({ entityType }) => entityType === 'shortcut').map(({ id }) => id));
  const mergedShortcuts = mergeRecord(snapshots.flatMap(({ shortcuts }) => shortcuts), mergeShortcut)
    .filter(({ id }) => !shortcutTombstones.has(id));
  const tombstones = allTombstones;
  const deleted = new Set(tombstones.map(({ entityType, id }) => tombstoneKey(entityType, id)));
  const folders = mergeRecord(snapshots.flatMap(({ folders }) => folders), mergeFolder)
    .filter(({ id }) => !deleted.has(tombstoneKey('folder', id)))
    .toSorted((left, right) => left.position.value - right.position.value
      || registerOrder(right.position, left.position) || compareText(left.id, right.id));
  const shortcuts = mergedShortcuts;
  const settings = mergeSettings(snapshots);
  const engines = settings.customEngines.filter(({ value }) => !deleted.has(tombstoneKey('custom-engine', value.id)));
  const liveSettings = { ...settings, customEngines: engines };
  assertReferencesAlive({ settings: liveSettings, shortcuts, tombstones: deleted });
  const assetReferences = referencedAssets(shortcuts, liveSettings);
  const localLatest = snapshots.find(({ deviceId }) => deviceId === local.deviceId);
  if (!localLatest) fail('本机同步快照不存在');
  const mergedPayload = {
    schemaVersion: SYNC_SCHEMA_VERSION, vaultId: first.vaultId, deviceId: local.deviceId,
    folders, shortcuts, settings: liveSettings,
    assets: mergeAssets(snapshots, deleted, assetReferences), tombstones,
  };
  const changed = JSON.stringify(mergedPayload) !== JSON.stringify({
    schemaVersion: localLatest.schemaVersion, vaultId: localLatest.vaultId, deviceId: localLatest.deviceId,
    folders: localLatest.folders, shortcuts: localLatest.shortcuts,
    settings: localLatest.settings, assets: localLatest.assets, tombstones: localLatest.tombstones,
  });
  const merged: SyncSnapshot = { ...mergedPayload, generation: localLatest.generation + (changed ? 1 : 0) };
  return parseSyncSnapshot(merged);
}
