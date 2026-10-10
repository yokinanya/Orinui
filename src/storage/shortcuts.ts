import { fail } from '@/domain/errors';
import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import type { Shortcut, ShortcutIcon } from '@/domain/shortcut';
import { normalizeShortcutTitle } from '@/domain/text';
import { normalizeShortcutUrl } from '@/domain/url';
import type { Database } from '@/storage/db';
import { byOrder, moveTo, nextOrder, renumber, swap, targetIndex } from '@/storage/order';

export interface NewShortcut {
  groupId: string;
  title: string;
  url: string;
  icon?: ShortcutIcon;
  iconSourceUrl?: string | null;
}

export interface ShortcutPatch {
  title?: string;
  url?: string;
  icon?: ShortcutIcon;
  iconSourceUrl?: string | null;
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

  return db.transaction('rw', db.groups, db.shortcuts, async () => {
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
      icon: input.icon ?? { kind: 'letter' },
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

  return db.transaction('rw', db.shortcuts, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    const updated: Shortcut = {
      ...current,
      title: title ?? current.title,
      url: url ?? current.url,
      icon: patch.icon ?? current.icon,
      iconSourceUrl: patch.iconSourceUrl === undefined ? current.iconSourceUrl : patch.iconSourceUrl,
    };

    await db.shortcuts.put(updated);
    return updated;
  });
}

/** 删除并返回被删除的记录，供调用方在提示条中提供撤销。 */
export async function deleteShortcut(db: Database, id: string): Promise<Shortcut> {
  return db.transaction('rw', db.shortcuts, async () => {
    const current = await db.shortcuts.get(id);
    if (!current) fail('网站不存在');

    await db.shortcuts.delete(id);
    await db.shortcuts.bulkPut(renumber(await db.shortcuts.where('groupId').equals(current.groupId).toArray()));
    return current;
  });
}

/** 恢复被删除的记录；原分组已不存在时明确报错，不静默放到别处。 */
export async function restoreShortcut(db: Database, shortcut: Shortcut): Promise<Shortcut> {
  return db.transaction('rw', db.groups, db.shortcuts, async () => {
    const group = await db.groups.get(shortcut.groupId);
    if (!group) fail('原分组已被删除，无法撤销');

    const siblings = await db.shortcuts.where('groupId').equals(shortcut.groupId).toArray();
    const restored: Shortcut = { ...shortcut, order: nextOrder(siblings) };
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
