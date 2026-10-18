import { fail } from '@/domain/errors';
import type { Folder } from '@/domain/folder';
import type { MediaAsset } from '@/domain/asset';
import type { AppSettings } from '@/domain/settings';
import type { Shortcut } from '@/domain/shortcut';
import type { SyncRegister, SyncSnapshot } from '@/domain/sync/types';
import { parseSyncSnapshot } from '@/domain/sync/validate';

export interface MaterializedSyncData {
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly Omit<MediaAsset, 'blob'>[];
}

interface OrderBy<T> {
  readonly position: (item: T) => number;
  readonly version: (item: T) => SyncRegister<unknown>;
  readonly id: (item: T) => string;
}

function ordered<T>(items: readonly T[], by: OrderBy<T>): T[] {
  return [...items].sort((left, right) => by.position(left) - by.position(right) ||
    by.version(right).clock - by.version(left).clock || compareText(by.version(right).deviceId, by.version(left).deviceId) || compareText(by.id(left), by.id(right)));
}

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function materializeSyncSnapshot(input: SyncSnapshot): MaterializedSyncData {
  const snapshot = parseSyncSnapshot(input);
  const folders: Folder[] = ordered(snapshot.folders, {
    position: ({ position }) => position.value, version: ({ position }) => position, id: ({ id }) => id,
  }).map((folder, order) => ({ id: folder.id, name: folder.name.value, order }));
  const liveFolderIds = new Set(folders.map(({ id }) => id));
  const nextOrderByContainer = new Map<string, number>();
  const shortcuts: Shortcut[] = [];
  for (const shortcut of ordered(snapshot.shortcuts, {
    position: ({ placement }) => placement.value.order, version: ({ placement }) => placement, id: ({ id }) => id,
  })) {
    const placement = shortcut.placement.value;
    // 墓碑永久保留；回主页仅是投影，不改写 placement 的值或逻辑版本。
    const folderId = placement.folderId !== null && liveFolderIds.has(placement.folderId) ? placement.folderId : null;
    const key = folderId ?? '';
    const order = nextOrderByContainer.get(key) ?? 0;
    nextOrderByContainer.set(key, order + 1);
    const icon = shortcut.icon.value;
    const asset = icon.kind === 'asset' ? snapshot.assets.find(({ id }) => id === icon.assetId) : undefined;
    if (icon.kind === 'asset' && !asset) fail(`网站图标资源不存在：${icon.assetId}`);
    shortcuts.push({ id: shortcut.id, folderId, order, title: shortcut.title.value, url: shortcut.url.value,
      icon, iconSourceUrl: asset?.sourceUrl.value ?? null });
  }
  const settings: AppSettings = {
    appearance: snapshot.settings.appearance.value,
    search: { defaultEngineId: snapshot.settings.defaultEngineId.value,
      customEngines: snapshot.settings.customEngines.map(({ value }) => value),
      ...snapshot.settings.searchPreferences.value },
    shortcuts: snapshot.settings.shortcutPreferences.value,
    layout: snapshot.settings.layout.value, clock: snapshot.settings.clock.value,
  };
  const assets = snapshot.assets.map(({ id, kind, mime, width, height, sourceUrl, name, motion }) => ({ id, kind, mime, width, height,
    sourceUrl: sourceUrl.value, name: name.value, ...(motion ? { motion } : {}) }));
  return { folders, shortcuts, settings, assets };
}
