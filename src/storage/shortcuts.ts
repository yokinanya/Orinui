import { fail } from '@/domain/errors';
import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import type { Shortcut, ShortcutIcon } from '@/domain/shortcut';
import { normalizeShortcutTitle } from '@/domain/text';
import { normalizeShortcutUrl } from '@/domain/url';
import type { Database } from '@/storage/db';
import { byOrder, moveTo, nextOrder, renumber, swap, targetIndex } from '@/storage/order';
import type { ImageAsset } from '@/domain/asset';
import { ASSET_TOTAL_LIMIT_BYTES, totalAssetBytes, createImageAsset, pruneUnreferencedAssets, releaseReplacedAsset, type NewImageAsset } from '@/storage/assets';

export interface NewShortcut {
  groupId: string;
  title: string;
  url: string;
  icon?: ShortcutIcon;
  iconSourceUrl?: string | null;
  image?: NewImageAsset;
}

export interface ShortcutPatch {
  title?: string;
  url?: string;
  icon?: ShortcutIcon;
  iconSourceUrl?: string | null;
  image?: NewImageAsset;
}

export interface RemovedShortcut extends Shortcut {
  readonly removedAsset: ImageAsset | null;
}

async function resolveIcon(db: Database, input: {
  readonly icon: ShortcutIcon;
  readonly image?: NewImageAsset;
}): Promise<ShortcutIcon> {
  if (input.image) {
    if (input.image.kind !== 'icon') fail('网站图标需要图标图片资源');
    const asset = await createImageAsset(db, input.image);
    return { kind: 'asset', assetId: asset.id };
  }
  if (input.icon.kind === 'letter') return { kind: 'letter' };
  if (input.icon.kind === 'built-in') {
    if (!['compass', 'book', 'briefcase', 'code', 'heart', 'sparkles'].includes(input.icon.iconId)) fail('内置图标无效');
    return input.icon;
  }
  if (input.icon.kind !== 'asset') fail('图标类型不正确');
  const asset = await db.assets.get(input.icon.assetId);
  if (!asset || asset.kind !== 'icon') fail('网站图标资源不存在');
  return { kind: 'asset', assetId: asset.id };
}

export async function listShortcuts(db: Database, groupId: string): Promise<Shortcut[]> {
  return byOrder(await db.shortcuts.where('groupId').equals(groupId).toArray());
}

export async function countShortcuts(db: Database): Promise<number> {
  return db.shortcuts.count();
}

export async function createShortcut(db: Database, input: NewShortcut): Promise<Shortcut> {
  const title = normalizeShortcutTitle(input.title);
  const url = normalizeShortcutUrl(input.url);

  return db.transaction('rw', db.groups, db.shortcuts, db.assets, async () => {
    const group = await db.groups.get(input.groupId);
    if (!group) fail('目标分组不存在');

    if ((await db.shortcuts.count()) >= LIMITS.shortcuts) {
      fail(`最多只能有 ${LIMITS.shortcuts} 个网站`);
    }

    const siblings = await db.shortcuts.where('groupId').equals(input.groupId).toArray();
    const shortcut: Shortcut = {
      id: newId(),
      groupId: input.groupId,
      title,
      url,
      icon: await resolveIcon(db, { icon: input.icon ?? { kind: 'letter' }, image: input.image }),
      iconSourceUrl: input.iconSourceUrl ?? null,
      order: nextOrder(siblings),
    };

    await db.shortcuts.add(shortcut);
    return shortcut;
  });
}

export async function updateShortcut(db: Database, id: string, patch: ShortcutPatch): Promise<Shortcut> {
  const title = patch.title === undefined ? undefined : normalizeShortcutTitle(patch.title);
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
      icon: await resolveIcon(db, { icon: patch.icon ?? current.icon, image: patch.image }),
      iconSourceUrl: patch.iconSourceUrl === undefined ? current.iconSourceUrl : patch.iconSourceUrl,
    };

    await db.shortcuts.put(updated);
    await pruneUnreferencedAssets(db);
    return updated;
  });
}

/** 删除并返回被删除的记录，供调用方在提示条中提供撤销。 */
export async function deleteShortcut(db: Database, id: string): Promise<RemovedShortcut> {
  return db.transaction('rw', db.shortcuts, db.assets, db.settings, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    const removedAsset = current.icon.kind === 'asset' ? await db.assets.get(current.icon.assetId) : null;
    await db.shortcuts.delete(id);
    await db.shortcuts.bulkPut(renumber(await db.shortcuts.where('groupId').equals(current.groupId).toArray()));
    await pruneUnreferencedAssets(db);
    return { ...current, removedAsset: removedAsset ?? null };
  });
}

/** 恢复被删除的记录；原分组已不存在时明确报错，不静默放到别处。 */
export async function restoreShortcut(db: Database, shortcut: Shortcut & { readonly removedAsset?: ImageAsset | null }): Promise<Shortcut> {
  return db.transaction('rw', db.groups, db.shortcuts, db.assets, async () => {
    const group = await db.groups.get(shortcut.groupId);
    if (!group) fail('原分组已被删除，无法撤销');

    if (await db.shortcuts.count() >= LIMITS.shortcuts) fail('网站数量已达上限，无法撤销');
    const { removedAsset, ...record } = shortcut;
    if (removedAsset && !await db.assets.get(removedAsset.id)) {
      if (await totalAssetBytes(db) + removedAsset.blob.size > ASSET_TOTAL_LIMIT_BYTES) fail('图片总大小超限，无法撤销');
      await db.assets.add(removedAsset);
    }
    await resolveIcon(db, { icon: record.icon });
    const siblings = await db.shortcuts.where('groupId').equals(shortcut.groupId).toArray();
    const restored: Shortcut = { ...record, order: nextOrder(siblings) };
    await db.shortcuts.add(restored);
    return restored;
  });
}

/** 在所属分组内上移或下移；已在边界时返回 false。 */
export async function moveShortcut(db: Database, id: string, direction: 'up' | 'down'): Promise<boolean> {
  return db.transaction('rw', db.shortcuts, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    const siblings = await listShortcuts(db, current.groupId);
    const index = siblings.findIndex((shortcut) => shortcut.id === id);
    const target = targetIndex(index, direction, siblings.length);
    if (target === null) return false;

    await db.shortcuts.bulkPut(swap(siblings, index, target));
    return true;
  });
}

/** 移动到组内指定下标，供拖动排序使用；位置未变化时不做写入。 */
export async function reorderShortcut(db: Database, id: string, index: number): Promise<void> {
  await db.transaction('rw', db.shortcuts, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    const siblings = byOrder(await db.shortcuts.where('groupId').equals(current.groupId).toArray());
    const next = moveTo(siblings, id, index);
    if (!next) return;

    await db.shortcuts.bulkPut(next);
  });
}

/** 移动到另一个分组，追加到目标分组末尾，并重排原分组。 */
export async function moveShortcutToGroup(db: Database, id: string, targetGroupId: string): Promise<Shortcut> {
  return db.transaction('rw', db.groups, db.shortcuts, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');
    if (current.groupId === targetGroupId) return current;

    const group = await db.groups.get(targetGroupId);
    if (!group) fail('目标分组不存在');

    const targetSiblings = await db.shortcuts.where('groupId').equals(targetGroupId).toArray();
    const moved: Shortcut = { ...current, groupId: targetGroupId, order: nextOrder(targetSiblings) };
    await db.shortcuts.put(moved);

    const sourceSiblings = await db.shortcuts.where('groupId').equals(current.groupId).toArray();
    await db.shortcuts.bulkPut(renumber(sourceSiblings));

    return moved;
  });
}

/** 删除分组前统计其网站数量，用于确认提示。 */
export async function countShortcutsInGroup(db: Database, groupId: string): Promise<number> {
  return db.shortcuts.where('groupId').equals(groupId).count();
}
