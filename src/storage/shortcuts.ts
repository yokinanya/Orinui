import { fail } from '@/domain/errors';
import { reconcileStoredHome } from '@/storage/home';
import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import type { Shortcut, ShortcutIcon } from '@/domain/shortcut';
import { parseShortcutIcon, parseSvgIconColor } from '@/domain/shortcut-icon';
import { normalizeOptionalShortcutTitle } from '@/domain/text';
import { normalizeShortcutUrl } from '@/domain/url';
import type { Database } from '@/storage/db';
import { byOrder, moveTo, nextOrder, renumber, swap, targetIndex } from '@/storage/order';
import type { MediaAsset } from '@/domain/asset';
import { createMediaAsset, pruneUnreferencedAssets, releaseReplacedAsset, type NewMediaAsset } from '@/storage/assets';

export interface NewShortcut {
  folderId?: string | null;
  title: string;
  url: string;
  icon?: ShortcutIcon;
  svgColor?: string | null;
  iconSourceUrl?: string | null;
  image?: NewMediaAsset;
}

export interface ShortcutPatch {
  title?: string;
  url?: string;
  icon?: ShortcutIcon;
  svgColor?: string | null;
  iconSourceUrl?: string | null;
  image?: NewMediaAsset;
}

export interface RemovedShortcut extends Shortcut {
  readonly removedAsset: MediaAsset | null;
}

async function resolveIcon(db: Database, input: {
  readonly icon: ShortcutIcon;
  readonly image?: NewMediaAsset;
  readonly svgColor?: string | null;
}): Promise<ShortcutIcon> {
  const icon = parseShortcutIcon(input.icon);
  const color = resolveSvgColor(icon, input.svgColor);
  if (input.image) {
    if (input.image.kind !== 'icon') fail('网站图标需要图标图片资源');
    const asset = await createMediaAsset(db, input.image);
    return createAssetIcon({ assetId: asset.id, mime: asset.mime, occupancy: icon.occupancy, color });
  }
  if (icon.kind !== 'asset') {
    if (color) fail('颜色只能用于 SVG 图标');
    return icon;
  }
  const asset = await db.assets.get(icon.assetId);
  if (!asset || asset.kind !== 'icon') fail('网站图标资源不存在');
  return createAssetIcon({ assetId: asset.id, mime: asset.mime, occupancy: icon.occupancy, color });
}

function resolveSvgColor(icon: ShortcutIcon, requested?: string | null): string | null {
  const color = requested === undefined && icon.kind === 'asset' ? icon.color : requested;
  return color === undefined || color === null ? null : parseSvgIconColor(color);
}

function createAssetIcon(input: { readonly assetId: string; readonly mime: MediaAsset['mime'];
  readonly occupancy: number | undefined; readonly color: string | null }): ShortcutIcon {
  if (input.color && input.mime !== 'image/svg+xml') fail('颜色只能用于 SVG 图标');
  return parseShortcutIcon({ kind: 'asset', assetId: input.assetId,
    ...(input.occupancy === undefined ? {} : { occupancy: input.occupancy }), ...(input.color === null ? {} : { color: input.color }) });
}

/** 主页网格上的网站：不隶属任何文件夹。 */
export async function listHomepageShortcuts(db: Database): Promise<Shortcut[]> {
  return db.shortcuts.filter((shortcut) => shortcut.folderId === null).toArray()
    .then((shortcuts) => byOrder(shortcuts));
}

/** 某个文件夹里的网站，按文件夹内顺序排列。 */
export async function listFolderShortcuts(db: Database, folderId: string): Promise<Shortcut[]> {
  return byOrder(await db.shortcuts.where('folderId').equals(folderId).toArray());
}

export async function listAllShortcuts(db: Database): Promise<Shortcut[]> {
  return (await db.shortcuts.toArray()).toSorted((left, right) =>
    (left.folderId ?? '').localeCompare(right.folderId ?? '') || left.order - right.order);
}

export async function countShortcuts(db: Database): Promise<number> {
  return db.shortcuts.count();
}

export async function createShortcut(db: Database, input: NewShortcut): Promise<Shortcut> {
  const title = normalizeOptionalShortcutTitle(input.title);
  const url = normalizeShortcutUrl(input.url);
  const folderId = input.folderId ?? null;

  return db.transaction('rw', db.folders, db.shortcuts, db.assets, db.settings, async () => {
    if (folderId !== null && !await db.folders.get(folderId)) fail('目标文件夹不存在');

    if ((await db.shortcuts.count()) >= LIMITS.shortcuts) {
      fail(`最多只能有 ${LIMITS.shortcuts} 个网站`);
    }

    const siblings = folderId === null ? await listHomepageShortcuts(db) : await listFolderShortcuts(db, folderId);
    const shortcut: Shortcut = {
      id: newId(),
      folderId,
      title,
      url,
      icon: await resolveIcon(db, { icon: input.icon ?? { kind: 'letter' }, image: input.image, svgColor: input.svgColor }),
      iconSourceUrl: input.iconSourceUrl ?? null,
      order: nextOrder(siblings),
    };

    await db.shortcuts.add(shortcut);
    await reconcileStoredHome(db);
    return shortcut;
  });
}

export async function updateShortcut(db: Database, id: string, patch: ShortcutPatch): Promise<Shortcut> {
  const title = patch.title === undefined ? undefined : normalizeOptionalShortcutTitle(patch.title);
  const url = patch.url === undefined ? undefined : normalizeShortcutUrl(patch.url);

  return db.transaction('rw', db.shortcuts, db.assets, db.settings, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    if (patch.image && current.icon.kind === 'asset') {
      await releaseReplacedAsset(db, { id: current.icon.assetId, shortcutId: id });
    }
    const updated: Shortcut = {
      ...current,
      title: title ?? current.title,
      url: url ?? current.url,
      icon: await resolveIcon(db, { icon: patch.icon ?? current.icon, image: patch.image, svgColor: patch.svgColor }),
      iconSourceUrl: patch.iconSourceUrl === undefined ? current.iconSourceUrl : patch.iconSourceUrl,
    };

    await db.shortcuts.put(updated);
    await pruneUnreferencedAssets(db);
    return updated;
  });
}

/** 与给定网站同一容器（主页网格或同一文件夹）的网站。 */
async function siblingsOf(db: Database, shortcut: Pick<Shortcut, 'folderId'>): Promise<Shortcut[]> {
  return shortcut.folderId === null ? listHomepageShortcuts(db) : listFolderShortcuts(db, shortcut.folderId);
}

/** 删除并返回被删除的记录，供调用方在提示条中提供撤销。 */
export async function deleteShortcut(db: Database, id: string): Promise<RemovedShortcut> {
  return db.transaction('rw', db.folders, db.shortcuts, db.assets, db.settings, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    const removedAsset = current.icon.kind === 'asset' ? await db.assets.get(current.icon.assetId) : null;
    const siblings = await siblingsOf(db, current);
    await db.shortcuts.delete(id);
    await reconcileStoredHome(db);
    await db.shortcuts.bulkPut(renumber(siblings.filter((shortcut) => shortcut.id !== id)));
    await pruneUnreferencedAssets(db);
    return { ...current, removedAsset: removedAsset ?? null };
  });
}

/** 恢复被删除的记录；原文件夹已不存在时明确报错，不静默放到别处。 */
export async function restoreShortcut(db: Database, shortcut: Shortcut & { readonly removedAsset?: MediaAsset | null }): Promise<Shortcut> {
  return db.transaction('rw', db.folders, db.shortcuts, db.assets, db.settings, async () => {
    if (shortcut.folderId !== null && !await db.folders.get(shortcut.folderId)) fail('原文件夹已被删除，无法撤销');

    if (await db.shortcuts.count() >= LIMITS.shortcuts) fail('网站数量已达上限，无法撤销');
    const { removedAsset, ...record } = shortcut;
    if (removedAsset && !await db.assets.get(removedAsset.id)) {
      await db.assets.add(removedAsset);
    }
    await resolveIcon(db, { icon: record.icon });
    const siblings = await siblingsOf(db, shortcut);
    const restored: Shortcut = { ...record, order: nextOrder(siblings) };
    await db.shortcuts.add(restored);
    await reconcileStoredHome(db);
    return restored;
  });
}

/** 在同一容器（主页网格或某个文件夹）内上移或下移；已在边界时返回 false。 */
export async function moveShortcut(db: Database, id: string, direction: 'up' | 'down'): Promise<boolean> {
  return db.transaction('rw', db.shortcuts, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    const siblings = await siblingsOf(db, current);
    const index = siblings.findIndex((shortcut) => shortcut.id === id);
    const target = targetIndex(index, direction, siblings.length);
    if (target === null) return false;

    await db.shortcuts.bulkPut(swap(siblings, index, target));
    return true;
  });
}

/** 移动到同一容器内的指定下标，供拖动排序使用；位置未变化时不做写入。 */
export async function reorderShortcut(db: Database, id: string, index: number): Promise<void> {
  await db.transaction('rw', db.shortcuts, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    const next = moveTo(await siblingsOf(db, current), id, index);
    if (!next) return;

    await db.shortcuts.bulkPut(next);
  });
}

/**
 * 移动到另一个容器，追加到末尾，并重排原容器。
 *
 * `folderId` 为 null 表示移回主页网格。
 */
export async function moveShortcutToFolder(db: Database, id: string, folderId: string | null): Promise<Shortcut> {
  return db.transaction('rw', db.folders, db.shortcuts, db.settings, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');
    if (current.folderId === folderId) return current;

    if (folderId !== null && !await db.folders.get(folderId)) fail('目标文件夹不存在');

    const targetSiblings = (await siblingsOf(db, { folderId })).filter((shortcut) => shortcut.id !== id);
    const moved: Shortcut = { ...current, folderId, order: nextOrder(targetSiblings) };
    await db.shortcuts.put(moved);

    const sourceSiblings = (await siblingsOf(db, current)).filter((shortcut) => shortcut.id !== id);
    await db.shortcuts.bulkPut(renumber(sourceSiblings));
    await reconcileStoredHome(db);
    return moved;
  });
}
