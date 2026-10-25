import { fail } from '@/domain/errors';
import { reconcileStoredHome } from '@/storage/home';
import type { Folder } from '@/domain/folder';
import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import { normalizeFolderName } from '@/domain/text';
import { pruneUnreferencedAssets } from '@/storage/assets';
import type { Database } from '@/storage/db';
import { byOrder, moveTo, nextOrder, renumber, swap, targetIndex } from '@/storage/order';

export async function listFolders(db: Database): Promise<Folder[]> {
  return byOrder(await db.folders.toArray());
}

export async function createFolder(db: Database, name: string): Promise<Folder> {
  const normalized = normalizeFolderName(name);

  return db.transaction('rw', db.folders, db.shortcuts, db.settings, async () => {
    const existing = await db.folders.toArray();
    if (existing.length >= LIMITS.folders) fail(`最多只能有 ${LIMITS.folders} 个文件夹`);

    const folder: Folder = { id: newId(), name: normalized, order: nextOrder(existing) };
    await db.folders.add(folder);
    await reconcileStoredHome(db);
    return folder;
  });
}

export async function renameFolder(db: Database, id: string, name: string): Promise<Folder> {
  const normalized = normalizeFolderName(name);

  return db.transaction('rw', db.folders, async () => {
    const folder = await db.folders.get(id);
    if (!folder) fail('文件夹不存在');

    const updated: Folder = { ...folder, name: normalized };
    await db.folders.put(updated);
    return updated;
  });
}

/**
 * 删除文件夹。
 *
 * 文件夹只是容器：删除时其中的网站回到主页网格末尾，与用户预期一致。
 * 返回被移出的网站数量，供提示条说明。
 */
export async function deleteFolder(db: Database, id: string): Promise<{ movedShortcuts: number }> {
  return db.transaction('rw', db.folders, db.shortcuts, db.assets, db.settings, async () => {
    const folder = await db.folders.get(id);
    if (!folder) fail('文件夹不存在');

    const contained = byOrder(await db.shortcuts.where('folderId').equals(id).toArray());
    const homepage = await db.shortcuts.filter((shortcut) => shortcut.folderId === null).toArray();
    let order = nextOrder(homepage);
    const released = contained.map((shortcut) => { const moved = { ...shortcut, folderId: null, order }; order += 1; return moved; });
    const previousFolders = byOrder(await db.folders.toArray());
    const remainingFolders = previousFolders.filter((item) => item.id !== id);
    await db.shortcuts.bulkPut(released);
    await db.folders.delete(id);
    await db.folders.bulkPut(renumber(remainingFolders));
    await pruneUnreferencedAssets(db);
    await reconcileStoredHome(db);
    return { movedShortcuts: contained.length };
  });
}

/** 移动到全局顺序中的指定下标，供拖动排序使用；位置未变化时不做写入。 */
export async function reorderFolder(db: Database, id: string, index: number): Promise<void> {
  await db.transaction('rw', db.folders, async () => {
    const folders = byOrder(await db.folders.toArray());
    if (!folders.some((folder) => folder.id === id)) fail('文件夹不存在');

    const next = moveTo(folders, id, index);
    if (!next) return;

    await db.folders.bulkPut(next);
  });
}

/** 在全局顺序中上移或下移一个文件夹；已在边界时返回 false。 */
export async function moveFolder(db: Database, id: string, direction: 'up' | 'down'): Promise<boolean> {
  return db.transaction('rw', db.folders, async () => {
    const folders = byOrder(await db.folders.toArray());
    const index = folders.findIndex((folder) => folder.id === id);
    const target = targetIndex(index, direction, folders.length);
    if (target === null) return false;

    await db.folders.bulkPut(swap(folders, index, target));
    return true;
  });
}

/** 文件夹弹层里的网站数量，用于删除确认。 */
export async function countShortcutsInFolder(db: Database, folderId: string): Promise<number> {
  return db.shortcuts.where('folderId').equals(folderId).count();
}
