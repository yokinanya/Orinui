import { fail } from '@/domain/errors';
import type { Group, GroupColorRole } from '@/domain/group';
import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import { normalizeGroupName } from '@/domain/text';
import type { Database } from '@/storage/db';
import { byOrder, moveTo, nextOrder, renumber, swap, targetIndex } from '@/storage/order';

export const DEFAULT_GROUP_NAME = '常用';

export async function listGroups(db: Database): Promise<Group[]> {
  return byOrder(await db.groups.toArray());
}

/**
 * 保证存在系统默认分组。
 *
 * 只在完全没有分组时创建（首次安装或本地重置后）。若已有分组却没有默认分组，
 * 说明数据被外部破坏，这里直接报错而不是悄悄挑一个分组顶替。
 */
export async function ensureDefaultGroup(db: Database): Promise<Group> {
  return db.transaction('rw', db.groups, async () => {
    const groups = byOrder(await db.groups.toArray());

    const current = groups.find((group) => group.isDefault);
    if (current) return current;

    if (groups.length > 0) {
      throw new Error('分组数据缺少默认分组，本地数据可能已损坏');
    }

    const group: Group = {
      id: newId(),
      name: DEFAULT_GROUP_NAME,
      colorRole: 'primary',
      order: 0,
      isDefault: true,
    };
    await db.groups.add(group);
    return group;
  });
}

export async function createGroup(
  db: Database,
  name: string,
  colorRole: GroupColorRole | null = null,
): Promise<Group> {
  const normalized = normalizeGroupName(name);

  return db.transaction('rw', db.groups, async () => {
    const existing = await db.groups.toArray();
    if (existing.length >= LIMITS.groups) {
      fail(`最多只能有 ${LIMITS.groups} 个分组`);
    }

    const group: Group = {
      id: newId(),
      name: normalized,
      colorRole,
      order: nextOrder(existing),
      isDefault: false,
    };
    await db.groups.add(group);
    return group;
  });
}

export async function renameGroup(db: Database, id: string, name: string): Promise<Group> {
  const normalized = normalizeGroupName(name);

  return db.transaction('rw', db.groups, async () => {
    const group = await db.groups.get(id);
    if (!group) fail('分组不存在');

    const updated: Group = { ...group, name: normalized };
    await db.groups.put(updated);
    return updated;
  });
}

/**
 * 删除分组。
 *
 * 数据契约 §3：默认分组不可删除；删除其他分组会连同组内网站一起删除，
 * 由调用方负责二次确认。返回被删除的网站数量用于提示。
 */
export async function deleteGroup(db: Database, id: string): Promise<{ removedShortcuts: number }> {
  return db.transaction('rw', db.groups, db.shortcuts, async () => {
    const group = await db.groups.get(id);
    if (!group) fail('分组不存在');
    if (group.isDefault) fail('默认分组不能删除');

    const shortcuts = await db.shortcuts.where('groupId').equals(id).toArray();
    await db.shortcuts.bulkDelete(shortcuts.map((shortcut) => shortcut.id));
    await db.groups.delete(id);
    await db.groups.bulkPut(renumber(await db.groups.toArray()));

    return { removedShortcuts: shortcuts.length };
  });
}

/** 移动到全局顺序中的指定下标，供拖动排序使用；位置未变化时不做写入。 */
export async function reorderGroup(db: Database, id: string, index: number): Promise<void> {
  await db.transaction('rw', db.groups, async () => {
    const groups = byOrder(await db.groups.toArray());
    if (!groups.some((group) => group.id === id)) fail('分组不存在');

    const next = moveTo(groups, id, index);
    if (!next) return;

    await db.groups.bulkPut(next);
  });
}

/** 在全局顺序中上移或下移一个分组；已在边界时返回 false。 */
export async function moveGroup(db: Database, id: string, direction: 'up' | 'down'): Promise<boolean> {
  return db.transaction('rw', db.groups, async () => {
    const groups = byOrder(await db.groups.toArray());
    const index = groups.findIndex((group) => group.id === id);
    const target = targetIndex(index, direction, groups.length);
    if (target === null) return false;

    await db.groups.bulkPut(swap(groups, index, target));
    return true;
  });
}
