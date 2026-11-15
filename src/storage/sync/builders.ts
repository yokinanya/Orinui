import type { MediaAsset } from '@/domain/asset';
import type { BookmarkHiddenRule } from '@/domain/bookmark-preferences';
import { buildSyncHome } from '@/domain/sync/home';
import { EMPTY_HOME } from '@/domain/home';
import { splitLayout } from '@/domain/layout';
import type { Folder } from '@/domain/folder';
import type { AppSettings } from '@/domain/settings';
import type { SearchEngine } from '@/domain/search-engines';
import type { Shortcut } from '@/domain/shortcut';
import type { SyncAsset, SyncBookmarkRules, SyncFolder, SyncRegister, SyncSettings, SyncShortcut, SyncTombstone } from '@/domain/sync/types';
import { nextSyncCounter } from '@/domain/sync/version';
import type { SyncEntityRecordRow, SyncRecordRow, SyncStateRow, SyncTombstoneRecordRow } from '@/storage/sync/types';

export class SyncClock {
  private current: number;
  private dirty = false;
  readonly deviceId: string;

  constructor(state: SyncStateRow) {
    this.current = state.clock;
    this.deviceId = state.deviceId;
  }

  register<T>(value: T, previous?: SyncRegister<T>): SyncRegister<T> {
    if (previous && sameValue(previous.value, value)) return previous;
    this.dirty = true;
    this.current = nextSyncCounter(this.current);
    return { value, clock: this.current, deviceId: this.deviceId };
  }

  tombstone(entityType: SyncTombstone['entityType'], id: string): SyncTombstone {
    this.dirty = true;
    this.current = nextSyncCounter(this.current);
    return { entityType, id, clock: this.current, deviceId: this.deviceId };
  }

  markChanged(): void {
    this.dirty = true;
  }

  state(state: SyncStateRow): SyncStateRow {
    return { ...state, clock: this.current, generation: this.dirty ? nextSyncCounter(state.generation) : state.generation };
  }

  get changed(): boolean {
    return this.dirty;
  }
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function recordId<K extends SyncEntityRecordRow['kind']>(kind: K, entityId: string): `${K}:${string}` {
  return `${kind}:${entityId}`;
}

function livePrevious<K extends SyncEntityRecordRow['kind']>(
  record: SyncRecordRow | undefined,
  kind: K,
): Extract<SyncEntityRecordRow, { readonly kind: K }> | undefined {
  return record?.kind === kind ? record as Extract<SyncEntityRecordRow, { readonly kind: K }> : undefined;
}

interface BuildFolderRecordInput {
  readonly folder: Folder;
  readonly previous?: SyncRecordRow;
  readonly before?: Folder;
  readonly clock: SyncClock;
}

export function buildFolderRecord(input: BuildFolderRecordInput): Extract<SyncRecordRow, { kind: 'folder' }> {
  const { folder, previous, before, clock } = input;
  const old = livePrevious(previous, 'folder');
  const value: SyncFolder = {
    id: folder.id,
    name: registerAfterCompare({ value: folder.name, previous: old?.value.name, before: before?.name, hasBefore: before !== undefined, clock }),
    // 位置是原子值：父引用与同层顺序一起写入、一起决胜。
    position: registerAfterCompare({ value: { parentId: folder.parentId, order: folder.order },
      previous: old?.value.position, before: before && { parentId: before.parentId, order: before.order },
      hasBefore: before !== undefined, clock }),
  };
  return { id: recordId('folder', folder.id), kind: 'folder', entityId: folder.id, value };
}

interface BuildShortcutRecordInput {
  readonly shortcut: Shortcut;
  readonly previous?: SyncRecordRow;
  readonly before?: Shortcut;
  readonly clock: SyncClock;
}

export function buildShortcutRecord(input: BuildShortcutRecordInput): Extract<SyncRecordRow, { kind: 'shortcut' }> {
  const { shortcut, previous, before, clock } = input;
  const old = livePrevious(previous, 'shortcut');
  const value: SyncShortcut = {
    id: shortcut.id,
    title: registerAfterCompare({ value: shortcut.title, previous: old?.value.title, before: before?.title, hasBefore: before !== undefined, clock }),
    url: registerAfterCompare({ value: shortcut.url, previous: old?.value.url, before: before?.url, hasBefore: before !== undefined, clock }),
    placement: registerAfterCompare({ value: { folderId: shortcut.folderId, order: shortcut.order }, previous: old?.value.placement,
      before: before && { folderId: before.folderId, order: before.order }, hasBefore: before !== undefined, clock }),
    icon: registerAfterCompare({ value: shortcut.icon, previous: old?.value.icon, before: before?.icon, hasBefore: before !== undefined, clock }),
  };
  return { id: recordId('shortcut', shortcut.id), kind: 'shortcut', entityId: shortcut.id, value };
}

function registerAfterCompare<T>(input: { readonly value: T; readonly previous?: SyncRegister<T>; readonly before?: T;
  readonly hasBefore: boolean; readonly clock: SyncClock }): SyncRegister<T> {
  const { value, previous, before, hasBefore, clock } = input;
  if (hasBefore && previous && sameValue(value, before)) return previous;
  return clock.register(value, previous);
}

export function buildAssetRecord(asset: MediaAsset, previous: SyncRecordRow | undefined, clock: SyncClock): Extract<SyncRecordRow, { kind: 'asset' }> {
  const old = livePrevious(previous, 'asset');
  const value: Omit<SyncAsset, 'sha256'> = {
    id: asset.id, kind: asset.kind, mime: asset.mime, width: asset.width, height: asset.height, byteLength: asset.blob.size,
    sourceUrl: clock.register(asset.sourceUrl, old?.value.sourceUrl),
    name: clock.register(asset.name ?? null, old?.value.name),
    motion: asset.motion ? { kind: asset.motion.kind, duration: asset.motion.duration } : null,
  };
  const row: Extract<SyncRecordRow, { kind: 'asset' }> = { id: recordId('asset', asset.id), kind: 'asset', entityId: asset.id, value };
  return old?.kind === 'asset' && old.sha256 ? { ...row, sha256: old.sha256 } : row;
}

/**
 * 区域顺序与显隐各自是独立寄存器，编辑其一不会覆盖其他布局偏好。
 *
 * 隐藏规则逐条寄存器：`null` 是该规则的删除值。写入端按本地规则 ID 生成新版本；
 * 已在本机寄存器里记为 `null` 的 `ruleId` 不复用，这是**本地生成**的约束，
 * 不等于跨设备比较时对 `null` 做永久 delete-wins（合并仍是普通逐条 LWW）。
 */
export function buildBookmarkRules(input: {
  readonly current: AppSettings['bookmarks']['hiddenRules'];
  readonly previous: SyncBookmarkRules | undefined;
  readonly clock: SyncClock;
}): SyncBookmarkRules {
  const { current, previous, clock } = input;
  const next = new Map(current.map((rule) => [rule.ruleId, rule]));
  const ids = [...new Set([...next.keys(), ...Object.keys(previous ?? {})])].sort();
  return Object.fromEntries(ids.map((ruleId): [string, SyncRegister<BookmarkHiddenRule | null>] => {
    const prior = previous?.[ruleId];
    const rule = next.get(ruleId);
    if (rule) {
      if (prior?.value === null) throw new Error('已同步删除的隐藏规则标识不能复用');
      return [ruleId, clock.register(rule, prior)];
    }
    // 本地删除规则时写成 null 删除值；已是 null 时保持原寄存器不动。
    return [ruleId, prior?.value === null ? prior : clock.register(null, prior)];
  }));
}

export function buildSettingsRecord(settings: AppSettings, previous: SyncRecordRow | undefined, clock: SyncClock): Extract<SyncRecordRow, { kind: 'settings' }> {
  const old = livePrevious(previous, 'settings');
  const layout = splitLayout(settings.layout);
  const value: SyncSettings = {
    home: buildSyncHome({ home: settings.home ?? EMPTY_HOME, previous: old?.value.home,
      register: (value, previous) => clock.register(value, previous) }),
    appearance: clock.register(settings.appearance, old?.value.appearance),
    defaultEngineId: clock.register(settings.search.defaultEngineId, old?.value.defaultEngineId),
    layoutOrder: clock.register({ order: layout.order }, old?.value.layoutOrder),
    layoutVisibility: clock.register({ hidden: layout.hidden }, old?.value.layoutVisibility),
    layoutPreferences: clock.register(layout.preferences, old?.value.layoutPreferences),
    clock: clock.register(settings.clock, old?.value.clock),
    searchPreferences: clock.register({ width: settings.search.width, autoFocus: settings.search.autoFocus,
      openTarget: settings.search.openTarget }, old?.value.searchPreferences),
    searchCustomization: clock.register(settings.search.customization, old?.value.searchCustomization),
    shortcutPreferences: clock.register(settings.shortcuts, old?.value.shortcutPreferences),
    bookmarksEnabled: clock.register(settings.bookmarks.enabled, old?.value.bookmarksEnabled),
    bookmarksMode: clock.register(settings.bookmarks.mode, old?.value.bookmarksMode),
    bookmarksShowInSearch: clock.register(settings.bookmarks.showInSearch, old?.value.bookmarksShowInSearch),
    bookmarkRules: buildBookmarkRules({ current: settings.bookmarks.hiddenRules, previous: old?.value.bookmarkRules, clock }),
    customEngines: [],
  };
  return { id: recordId('settings', 'app'), kind: 'settings', entityId: 'app', value };
}

export function buildEngineRecord(engine: SearchEngine, previous: SyncRecordRow | undefined, clock: SyncClock): Extract<SyncRecordRow, { kind: 'custom-engine' }> {
  const old = livePrevious(previous, 'custom-engine');
  return { id: recordId('custom-engine', engine.id), kind: 'custom-engine', entityId: engine.id,
    value: clock.register(engine, old?.value) };
}

interface BuildTombstoneInput {
  readonly kind: 'folder' | 'shortcut' | 'asset' | 'custom-engine';
  readonly entityId: string;
  readonly previous?: SyncRecordRow;
  readonly clock: SyncClock;
}

export function buildTombstoneRecord(input: BuildTombstoneInput): SyncTombstoneRecordRow {
  const { kind, entityId, previous, clock } = input;
  if (previous?.kind === 'tombstone') return previous;
  // 文件夹墓碑保留删除时的父层引用：后代寄存器的父引用不变，物化时据此上溯最近存活祖先。
  // 顶层文件夹的父层是主页，与缺省（legacy）语义等价，因此不写 `parentId`，避免 wire 上
  // 出现 `null` 与缺省两种表达同一事实的形态。
  const parentId = kind === 'folder' ? folderParentOf(previous) : undefined;
  const tombstone = clock.tombstone(kind, entityId);
  return { id: recordId(kind, entityId), kind: 'tombstone', entityId,
    tombstone: parentId === undefined ? tombstone : { ...tombstone, parentId } };
}

function folderParentOf(previous: SyncRecordRow | undefined): string | undefined {
  const parentId = previous?.kind === 'folder' ? previous.value.position.value.parentId : null;
  return parentId ?? undefined;
}
