import { fail } from '@/domain/errors';
import { reconcileStoredHome } from '@/storage/home';
import { assertFolderTree, type Folder } from '@/domain/folder';
import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import { normalizeFolderName } from '@/domain/text';
import { pruneUnreferencedAssets } from '@/storage/assets';
import type { Database } from '@/storage/db';
import { byOrder, nextOrder } from '@/storage/order';

/**
 * 同层稳定排序：先 `order`，再 `id`（数据契约 §3）。
 *
 * 只用于文件夹专用读取与提升顺序；通用 `byOrder` 保持原样，避免波及网站等既有逻辑。
 */
function byLayer<T extends { readonly order: number; readonly id: string }>(items: readonly T[]): T[] {
  return [...items].toSorted((left, right) =>
    left.order - right.order || (left.id < right.id ? -1 : Number(left.id !== right.id)));
}

export async function listFolders(db: Database): Promise<Folder[]> {
  return byOrder(await db.folders.toArray());
}

/** 某一层（`parentId === null` 为顶层）的直接子文件夹，按同层顺序（`order`，其次 `id`）。 */
export async function listChildFolders(db: Database, parentId: string | null): Promise<Folder[]> {
  return byLayer(await db.folders.filter((folder) => folder.parentId === parentId).toArray());
}

/**
 * 在当前层新建文件夹。
 *
 * 追加到该层末尾；顶层文件夹同时占用一个主页格位，嵌套文件夹只存在于父容器内。
 * 深度没有硬上限，但父引用必须存在且不能成环。
 */
export async function createFolder(db: Database, name: string, parentId: string | null = null): Promise<Folder> {
  const normalized = normalizeFolderName(name);

  return db.transaction('rw', db.folders, db.shortcuts, db.settings, async () => {
    const existing = await db.folders.toArray();
    if (existing.length >= LIMITS.folders) fail(`最多只能有 ${LIMITS.folders} 个文件夹`);
    if (parentId !== null && !existing.some((folder) => folder.id === parentId)) fail('父文件夹不存在');

    const siblings = existing.filter((folder) => folder.parentId === parentId);
    const folder: Folder = { id: newId(), parentId, name: normalized, order: nextOrder(siblings) };
    assertFolderTree([...existing.map(({ id, parentId: parent }) => ({ id, parentId: parent })), { id: folder.id, parentId: folder.parentId }]);
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
 * 删除文件夹：只删除这一条记录，把**直接**子文件夹与直接网站提升到父层。
 *
 * 提升项按原相对顺序追加到目标层末尾；目标层既有项不重排、不全局重编号；深层子树连同
 * 全部标识原样保留。顶层文件夹被删时，提升项按顺序分配主页格位。
 * 返回被释放的直接网站数量，供提示条说明。
 */
export async function deleteFolder(db: Database, id: string): Promise<{ movedShortcuts: number; movedFolders: number }> {
  return db.transaction('rw', db.folders, db.shortcuts, db.assets, db.settings, async () => {
    const folder = await db.folders.get(id);
    if (!folder) fail('文件夹不存在');

    const allFolders = await db.folders.toArray();
    const parentId = folder.parentId;
    // 直接子文件夹按原相对顺序（order，其次 id）追加，保证重复执行与各设备一致。
    const promotedFolders = byLayer(allFolders.filter((item) => item.parentId === id));
    const remaining = allFolders.filter((item) => item.id !== id);
    const targetSiblings = remaining.filter((item) => item.parentId === parentId);
    const folderBase = nextOrder(targetSiblings);
    const folders = promotedFolders.map((item, index) => ({ ...item, parentId, order: folderBase + index }));

    const contained = byOrder(await db.shortcuts.where('folderId').equals(id).toArray());
    const shortcutSiblings = await db.shortcuts.filter((shortcut) => shortcut.folderId === parentId).toArray();
    const shortcutBase = nextOrder(shortcutSiblings.filter((shortcut) => shortcut.folderId === parentId));
    const released = contained.map((shortcut, index) => ({ ...shortcut, folderId: parentId, order: shortcutBase + index }));

    await db.shortcuts.bulkPut(released);
    if (folders.length > 0) await db.folders.bulkPut(folders);
    await db.folders.delete(id);
    await pruneUnreferencedAssets(db);
    await reconcileStoredHome(db);
    return { movedShortcuts: contained.length, movedFolders: promotedFolders.length };
  });
}

/**
 * 已废弃：文件夹不可移动、不可改父、不可同层重排（设计 §11.2 F-06）。
 *
 * 保留导出只为让旧调用点在编译期可见，调用会明确失败且不写入任何数据。
 */
export async function reorderFolder(_db: Database, _id: string, _index: number): Promise<void> {
  fail('文件夹不支持重排；只能在当前层新建、重命名和删除');
}

/** 已废弃：见 `reorderFolder`。 */
export async function moveFolder(_db: Database, _id: string, _direction: 'up' | 'down'): Promise<boolean> {
  fail('文件夹不支持移动；只能在当前层新建、重命名和删除');
}

/** 文件夹弹层里的网站数量，用于删除确认。 */
export async function countShortcutsInFolder(db: Database, folderId: string): Promise<number> {
  return db.shortcuts.where('folderId').equals(folderId).count();
}
