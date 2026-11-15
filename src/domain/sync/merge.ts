import { fail } from '@/domain/errors';
import { mergeSyncHome, resolveSyncHome } from '@/domain/sync/home';
import { SyncMergeConflictError } from '@/domain/sync/conflicts';
import { mergeBookmarkRuleRegisters } from '@/domain/sync/bookmarks';
import { parseSyncSnapshot } from '@/domain/sync/validate';
import { BUILT_IN_ENGINES, type SearchEngine } from '@/domain/search-engines';
import { maximumSyncClock, nextSyncCounter } from '@/domain/sync/version';
import { SYNC_SCHEMA_VERSION, type SyncAsset, type SyncEntityType, type SyncFolder,
  type SyncRegister, type SyncSettings, type SyncShortcut,
  type SyncSnapshot, type SyncTombstone } from '@/domain/sync/types';

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
  // 位置是 { parentId, order } 原子值：父与顺序不可分别胜出，避免混合态。
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
  const bookmarkRules = mergeBookmarkRuleRegisters(snapshots.map(({ settings }) => settings.bookmarkRules));
  let merged: SyncSettings = { ...first.settings, customEngines, bookmarkRules };
  for (const snapshot of snapshots.slice(1)) {
    merged = {
      home: mergeSyncHome([merged.home ?? {}, snapshot.settings.home ?? {}]),
      appearance: choose(merged.appearance, snapshot.settings.appearance),
      defaultEngineId: choose(merged.defaultEngineId, snapshot.settings.defaultEngineId),
      layoutOrder: choose(merged.layoutOrder, snapshot.settings.layoutOrder),
      layoutVisibility: choose(merged.layoutVisibility, snapshot.settings.layoutVisibility),
      layoutPreferences: choose(merged.layoutPreferences, snapshot.settings.layoutPreferences),
      clock: choose(merged.clock, snapshot.settings.clock),
      searchPreferences: choose(merged.searchPreferences, snapshot.settings.searchPreferences),
      searchCustomization: choose(merged.searchCustomization, snapshot.settings.searchCustomization),
      shortcutPreferences: choose(merged.shortcutPreferences, snapshot.settings.shortcutPreferences),
      bookmarksEnabled: choose(merged.bookmarksEnabled, snapshot.settings.bookmarksEnabled),
      bookmarksMode: choose(merged.bookmarksMode, snapshot.settings.bookmarksMode),
      bookmarksShowInSearch: choose(merged.bookmarksShowInSearch, snapshot.settings.bookmarksShowInSearch),
      bookmarkRules: mergeBookmarkRuleRegisters([merged.bookmarkRules, snapshot.settings.bookmarkRules]),
      customEngines: mergeEngines([...merged.customEngines, ...snapshot.settings.customEngines]),
    };
  }
  return merged;
}

function removeDeletedEngineKeywords(input: {
  readonly settings: SyncSettings;
  readonly snapshots: readonly SyncSnapshot[];
  readonly deviceId: string;
}): SyncSettings {
  const { settings, snapshots, deviceId } = input;
  const liveEngineIds = new Set([...BUILT_IN_ENGINES.map(({ id }) => id), ...settings.customEngines.map(({ value }) => value.id)]);
  const keywords = Object.fromEntries(Object.entries(settings.searchCustomization.value.engineKeywords)
    .filter(([engineId]) => liveEngineIds.has(engineId)));
  if (Object.keys(keywords).length === Object.keys(settings.searchCustomization.value.engineKeywords).length) return settings;
  const observedClock = snapshots.reduce((maximum, snapshot) => Math.max(maximum, maximumSyncClock(snapshot)), 0);
  return { ...settings, searchCustomization: { ...settings.searchCustomization,
    value: { ...settings.searchCustomization.value, engineKeywords: keywords },
    clock: nextSyncCounter(observedClock), deviceId } };
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

/**
 * 同键墓碑合并。
 *
 * 逻辑版本决定哪一条墓碑胜出，但**父层引用是已知信息，不是版本值**：
 *
 * - 较高版本缺少 `parentId`（legacy 或该设备从未观测到存活记录）时继承已确认的祖先，
 *   不用缺省把已知层级抹掉，否则后代会被错误地推到主页；
 * - 同一逻辑版本携带两个不同且都已知的父引用属于数据错误，整笔拒绝；
 * - 解析阶段已把 wire 的 `null` 规范化为缺省，因此缺省与已知值不构成冲突。
 *
 * 先按键分组再裁决，结论与输入顺序无关：已知父引用只按逻辑版本取最新的一条。
 */
function mergeTombstoneLists(lists: readonly (readonly SyncTombstone[])[]): SyncTombstone[] {
  const groups = new Map<string, SyncTombstone[]>();
  for (const tombstone of lists.flat()) {
    const key = tombstoneKey(tombstone.entityType, tombstone.id);
    const group = groups.get(key) ?? [];
    group.push(tombstone);
    groups.set(key, group);
  }
  const merged = [...groups.values()].map(mergeTombstoneGroup);
  return merged.sort((left, right) => compareText(left.entityType, right.entityType) || compareText(left.id, right.id));
}

/** 同键墓碑组：除父层引用外字段由逻辑版本决定；父层引用取已确认且最新的一条。 */
function mergeTombstoneGroup(group: readonly SyncTombstone[]): SyncTombstone {
  const [first] = group;
  if (!first) fail('删除墓碑不能为空');
  // 同一逻辑版本的两条墓碑都带父引用却不同，说明 wire 已损坏，不静默选一个。
  const parentByStamp = new Map<string, string>();
  for (const tombstone of group) {
    if (tombstone.parentId === undefined) continue;
    const stamp = `${tombstone.clock}:${tombstone.deviceId}`;
    const known = parentByStamp.get(stamp);
    if (known !== undefined && known !== tombstone.parentId) fail('同一删除墓碑逻辑版本包含不同父文件夹');
    parentByStamp.set(stamp, tombstone.parentId);
  }
  let winner = first;
  let latestKnown: SyncTombstone | undefined;
  for (const tombstone of group) {
    if (registerOrder(tombstone, winner) > 0) winner = tombstone;
    if (tombstone.parentId !== undefined && (!latestKnown || registerOrder(tombstone, latestKnown) > 0)) latestKnown = tombstone;
  }
  const parentId = latestKnown?.parentId;
  return winner.parentId === undefined && parentId !== undefined ? { ...winner, parentId } : winner;
}

function mergeTombstones(snapshots: readonly SyncSnapshot[]): SyncTombstone[] {
  return mergeTombstoneLists(snapshots.map(({ tombstones }) => tombstones));
}

/**
 * 给文件夹墓碑补上被删文件夹删除时的父层引用。
 *
 * 删除只产生被删文件夹自己的墓碑；要以「最近存活祖先」重建后代归属，就必须知道它是
 * 从哪一层删掉的。本次合并若在任一快照里见过该文件夹的存活记录，就把它的寄存器父引用
 * 写进墓碑；从未见过（legacy 远端墓碑）时保持缺省，由解析统一按主页处理。
 *
 * 只补墓碑元数据，不复活实体、不改后代寄存器、不改任何时钟。
 */
function withFolderTombstoneParents(input: {
  readonly tombstones: readonly SyncTombstone[];
  readonly folders: readonly SyncFolder[];
}): SyncTombstone[] {
  const parents = new Map(input.folders.map((folder) => [folder.id, folder.position.value.parentId]));
  return input.tombstones.map((tombstone) => {
    if (tombstone.entityType !== 'folder' || tombstone.parentId !== undefined) return tombstone;
    const parentId = parents.get(tombstone.id);
    // 主页（null）与 legacy 缺省在解析上等价，不写入多余字段，避免重合并产生假差异。
    if (!parentId) return tombstone;
    return { ...tombstone, parentId };
  });
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

/**
 * 文件夹同层排序键：先按寄存器里的顺序，再按逻辑版本、设备与标识。
 *
 * 只用于合并结果的确定性排序，不改写任何寄存器。
 */
function compareFolderPosition(left: SyncFolder, right: SyncFolder): number {
  return left.position.value.order - right.position.value.order
    || registerOrder(right.position, left.position)
    || compareText(left.position.value.parentId ?? '', right.position.value.parentId ?? '')
    || compareText(left.id, right.id);
}

/** 与键序无关的规范序列化：用于判断本次合并是否真的改变了内容。 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => compareText(left, right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
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
  const mergedFolders = mergeRecord(snapshots.flatMap(({ folders }) => folders), mergeFolder)
    .toSorted(compareFolderPosition);
  // 墓碑补父层引用必须看到合并前的存活记录：被删文件夹本身已在下面的过滤中去掉。
  const tombstones = withFolderTombstoneParents({ tombstones: allTombstones, folders: mergedFolders });
  const deleted = new Set(tombstones.map(({ entityType, id }) => tombstoneKey(entityType, id)));
  const folders = mergedFolders.filter(({ id }) => !deleted.has(tombstoneKey('folder', id)));
  const shortcuts = mergedShortcuts;
  const mergedSettings = mergeSettings(snapshots);
  const settings = { ...mergedSettings, home: resolveSyncHome({ fields: mergedSettings.home ?? {},
    deviceId: local.deviceId, clock: Math.max(...snapshots.map(maximumSyncClock)) }) };
  const engines = settings.customEngines.filter(({ value }) => !deleted.has(tombstoneKey('custom-engine', value.id)));
  const liveSettings = removeDeletedEngineKeywords({ settings: { ...settings, customEngines: engines },
    snapshots, deviceId: local.deviceId });
  assertReferencesAlive({ settings: liveSettings, shortcuts, tombstones: deleted });
  const assetReferences = referencedAssets(shortcuts, liveSettings);
  const localLatest = snapshots.find(({ deviceId }) => deviceId === local.deviceId);
  if (!localLatest) fail('本机同步快照不存在');
  const mergedPayload = {
    schemaVersion: SYNC_SCHEMA_VERSION, vaultId: first.vaultId, deviceId: local.deviceId,
    folders, shortcuts, settings: liveSettings,
    assets: mergeAssets(snapshots, deleted, assetReferences), tombstones,
  };
  // 用规范化 JSON 比较：设置对象的键序在合并与解析路径上不同，直接 stringify 会把
  // 语义相同的快照误判成「有变化」，导致每次重复合并都凭空抬高代次。
  const changed = canonicalJson(mergedPayload) !== canonicalJson({
    schemaVersion: localLatest.schemaVersion, vaultId: localLatest.vaultId, deviceId: localLatest.deviceId,
    folders: localLatest.folders, shortcuts: localLatest.shortcuts,
    settings: localLatest.settings, assets: localLatest.assets, tombstones: localLatest.tombstones,
  });
  const merged: SyncSnapshot = { ...mergedPayload, generation: localLatest.generation + (changed ? 1 : 0) };
  return parseSyncSnapshot(merged);
}