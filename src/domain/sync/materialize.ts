import { fail } from '@/domain/errors';
import { materializeHome } from '@/domain/sync/home';
import { folderTombstoneParents, resolveFolderParents, resolveFolderPlacement,
  type DeletedFolderParents } from '@/domain/sync/folders';
import { reconcileHome } from '@/domain/home';
import { joinLayout, type SlotId } from '@/domain/layout';
import type { BookmarkHiddenRule, BookmarkPreferences } from '@/domain/bookmark-preferences';
import type { Folder } from '@/domain/folder';
import type { MediaAsset } from '@/domain/asset';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { SyncBookmarkRules, SyncRegister, SyncSnapshot } from '@/domain/sync/types';
import { parseSyncSnapshot } from '@/domain/sync/validate';

export interface MaterializedSyncData {
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly Omit<MediaAsset, 'blob'>[];
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

interface FolderCandidate {
  readonly id: string;
  readonly parentId: string | null;
  /** 寄存器里记录的父引用；与物化父不同即表示祖先被删后派生。 */
  readonly registeredParentId: string | null;
  readonly name: string;
  readonly order: number;
  readonly clock: number;
  readonly deviceId: string;
}

/**
 * 同层排序：先按寄存器里的顺序，再按逻辑版本、设备与标识，保证任何设备得出同一结果。
 */
function compareCandidate(left: FolderCandidate, right: FolderCandidate): number {
  return left.order - right.order || right.clock - left.clock
    || compareText(right.deviceId, left.deviceId) || compareText(left.id, right.id);
}

/**
 * 物化文件夹树：保留未提升项的寄存器顺序，派生项追加到目标层末尾。
 *
 * 删除只产生被删文件夹自己的墓碑，后代寄存器的 `parentId` 仍指向已删节点；物化时把这类
 * 引用收敛到仍存活的最近一层。墓碑携带被删文件夹当时的父层引用，因此上溯可以跨多级；
 * 旧墓碑没有元数据时明确回到主页。
 *
 * 顺序只做派生：寄存器父引用没变的文件夹原样保留自己的 `order`，不重编号；因祖先被删
 * 而落到新层的文件夹按原相对顺序追加到该层既有最大 `order` 之后。这里只读快照，不改写
 * 任何寄存器、clock 或 deviceId。
 */
function materializeFolders(snapshot: SyncSnapshot): Folder[] {
  const deleted = folderTombstoneParents(snapshot.tombstones);
  const resolved = resolveFolderParents(snapshot.folders.map((folder) => ({
    id: folder.id, parentId: folder.position.value.parentId,
  })), deleted);
  const candidates: FolderCandidate[] = snapshot.folders.map((folder) => ({
    id: folder.id, name: folder.name.value,
    parentId: resolved.get(folder.id) ?? null,
    registeredParentId: folder.position.value.parentId,
    order: folder.position.value.order, clock: folder.position.clock, deviceId: folder.position.deviceId,
  }));
  const groups = new Map<string | null, FolderCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.parentId) ?? [];
    group.push(candidate);
    groups.set(candidate.parentId, group);
  }
  const folders: Folder[] = [];
  const parents = [...groups.keys()].toSorted((left, right) =>
    left === right ? 0 : left === null ? -1 : right === null ? 1 : compareText(left, right));
  for (const parentId of parents) {
    const group = groups.get(parentId) ?? [];
    const existing = group.filter((candidate) => candidate.registeredParentId === candidate.parentId);
    const promoted = group.filter((candidate) => candidate.registeredParentId !== candidate.parentId)
      .toSorted(compareCandidate);
    const base = existing.reduce((maximum, candidate) => Math.max(maximum, candidate.order + 1), 0);
    for (const candidate of existing) {
      folders.push({ id: candidate.id, parentId, name: candidate.name, order: candidate.order });
    }
    promoted.forEach((candidate, index) => {
      folders.push({ id: candidate.id, parentId, name: candidate.name, order: base + index });
    });
  }
  return folders.toSorted((left, right) => compareText(left.parentId ?? '', right.parentId ?? '')
    || left.order - right.order || compareText(left.id, right.id));
}

/**
 * 物化网站位置：保留未提升项的顺序，派生项追加到目标容器末尾。
 *
 * 网站所在文件夹被删时，placement 寄存器不变、clock/deviceId 不变，只在投影结果里落到
 * 最近存活祖先（通常是主页）。目标容器既有网站的最大 `order` 之后按原相对顺序追加，
 * 不重编号其他层。
 */
function materializeShortcuts(snapshot: SyncSnapshot, liveFolderIds: ReadonlySet<string>,
  deleted: DeletedFolderParents): Shortcut[] {
  const resolved = snapshot.shortcuts.map((shortcut) => ({
    shortcut, folderId: resolveFolderPlacement(shortcut.placement.value.folderId, liveFolderIds, deleted),
  }));
  // 每个容器的追加起点：既有（未提升）网站的最大 order + 1。
  const nextOrderByContainer = new Map<string, number>();
  for (const { shortcut, folderId } of resolved) {
    if (folderId !== shortcut.placement.value.folderId) continue;
    const key = folderId ?? '';
    nextOrderByContainer.set(key, Math.max(nextOrderByContainer.get(key) ?? 0, shortcut.placement.value.order + 1));
  }
  const ordered = resolved.toSorted((left, right) =>
    left.shortcut.placement.value.order - right.shortcut.placement.value.order
    || right.shortcut.placement.clock - left.shortcut.placement.clock
    || compareText(right.shortcut.placement.deviceId, left.shortcut.placement.deviceId)
    || compareText(left.shortcut.id, right.shortcut.id));
  const shortcuts: Shortcut[] = [];
  for (const { shortcut, folderId } of ordered) {
    const placement = shortcut.placement.value;
    const key = folderId ?? '';
    let order = placement.order;
    if (folderId !== placement.folderId) {
      order = nextOrderByContainer.get(key) ?? 0;
      nextOrderByContainer.set(key, order + 1);
    }
    const icon = shortcut.icon.value;
    const asset = icon.kind === 'asset' ? snapshot.assets.find(({ id }) => id === icon.assetId) : undefined;
    if (icon.kind === 'asset' && !asset) fail(`网站图标资源不存在：${icon.assetId}`);
    shortcuts.push({ id: shortcut.id, folderId, order, title: shortcut.title.value, url: shortcut.url.value,
      icon, iconSourceUrl: asset?.sourceUrl.value ?? null });
  }
  return shortcuts;
}

function materializeRules(rules: SyncBookmarkRules): BookmarkHiddenRule[] {
  return Object.values(rules).flatMap((register) => register.value === null ? [] : [register.value])
    .toSorted((left, right) => compareText(left.ruleId, right.ruleId));
}

function materializeBookmarks(snapshot: SyncSnapshot): BookmarkPreferences {
  return {
    enabled: snapshot.settings.bookmarksEnabled.value,
    mode: snapshot.settings.bookmarksMode.value,
    showInSearch: snapshot.settings.bookmarksShowInSearch.value,
    hiddenRules: materializeRules(snapshot.settings.bookmarkRules),
  };
}

function materializeLayout(snapshot: SyncSnapshot) {
  return joinLayout({
    order: snapshot.settings.layoutOrder.value.order as SlotId[],
    hidden: snapshot.settings.layoutVisibility.value.hidden as SlotId[],
    preferences: snapshot.settings.layoutPreferences.value,
  });
}

export function materializeSyncSnapshot(input: SyncSnapshot): MaterializedSyncData {
  const snapshot = parseSyncSnapshot(input);
  const deleted = folderTombstoneParents(snapshot.tombstones);
  const folders = materializeFolders(snapshot);
  const shortcuts = materializeShortcuts(snapshot, new Set(folders.map(({ id }) => id)), deleted);
  const settings: AppSettings = {
    home: reconcileHome({ home: materializeHome(snapshot.settings.home), folders, shortcuts }),
    appearance: snapshot.settings.appearance.value,
    search: { defaultEngineId: snapshot.settings.defaultEngineId.value,
      customEngines: snapshot.settings.customEngines.map(({ value }) => value),
      ...snapshot.settings.searchPreferences.value,
      customization: snapshot.settings.searchCustomization.value },
    shortcuts: snapshot.settings.shortcutPreferences.value,
    bookmarks: materializeBookmarks(snapshot),
    layout: materializeLayout(snapshot),
    clock: snapshot.settings.clock.value,
  };
  const assets = snapshot.assets.map(({ id, kind, mime, width, height, sourceUrl, name, motion }) => ({ id, kind, mime, width, height,
    sourceUrl: sourceUrl.value, name: name.value, ...(motion ? { motion } : {}) }));
  return { folders, shortcuts, settings, assets };
}
