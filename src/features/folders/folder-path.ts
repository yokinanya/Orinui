import { folderPath, type Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';

/** 同层稳定顺序：order，其次 id，避免同序号时来回跳动。 */
export function sortFolders(folders: readonly Folder[]): Folder[] {
  return [...folders].toSorted((left, right) =>
    left.order - right.order || (left.id < right.id ? -1 : Number(left.id !== right.id)));
}

/** 当前层的直接子文件夹，只认 parentId，不按名称或路径前缀推断。 */
export function childFolders(folders: readonly Folder[], parentId: string): Folder[] {
  return sortFolders(folders.filter((folder) => folder.parentId === parentId));
}

/**
 * 从顶层到目标文件夹的完整路径。
 *
 * 复用领域层的迭代实现：父引用缺失或成环时停在仍可确认的一段，不会死循环；
 * 面包屑与移动菜单都只根据它生成路径文案。
 */
export function folderTrail(folders: readonly Folder[], folderId: string): Folder[] {
  return folderPath(folders, folderId);
}

/** 面包屑与移动菜单用的完整路径；顶层文件夹就是自身名称。 */
export function folderPathLabel(folders: readonly Folder[], folderId: string): string {
  const trail = folderTrail(folders, folderId);
  return trail.length > 0 ? trail.map(({ name }) => name).join(' / ') : '未知文件夹';
}

/** 文件夹弹层的路径起点：与搜索结果、视觉规格一致，从「主页」起算。 */
export const HOME_PATH_LABEL = '主页';

/**
 * 弹层用的完整路径文案（`主页 / A / B`）。
 *
 * 移动菜单、重命名说明等非主页语境仍用 `folderPathLabel`，不带「主页」，
 * 避免把「主页」错误地当成一个文件夹名称。这里只负责弹层路径的展示。
 */
export function folderHomePathLabel(folders: readonly Folder[], folderId: string): string {
  const trail = folderTrail(folders, folderId);
  return [HOME_PATH_LABEL, ...trail.map(({ name }) => name)].join(' / ');
}

/**
 * 最近仍存在的祖先文件夹。
 *
 * 父文件夹可能在其他窗口或同步中被删除，此时 `parentId` 指向不存在的记录。
 * 先按本次会话记住的路径（`rememberedTrail`）向上找仍存在的节点，再沿残留父引用兜底；
 * 都没有时返回 null，由调用方回到主页，而不是停在一个不存在的层级上。
 */
export function nearestExtantAncestor(
  folders: readonly Folder[],
  from: Folder,
  rememberedTrail: readonly Folder[],
): string | null {
  const extant = new Set(folders.map(({ id }) => id));
  const start = rememberedTrail.findIndex((item) => item.id === from.id);
  if (start > 0) {
    for (const candidate of rememberedTrail.slice(0, start).reverse()) {
      if (extant.has(candidate.id)) return candidate.id;
    }
  }
  let parentId: string | null = from.parentId;
  const seen = new Set<string>([from.id]);
  while (parentId !== null && !seen.has(parentId)) {
    seen.add(parentId);
    if (extant.has(parentId)) return parentId;
    parentId = folders.find((item) => item.id === parentId)?.parentId ?? null;
  }
  return null;
}

export interface FolderContentsStats {
  readonly folders: number;
  readonly shortcuts: number;
}

/**
 * 递归统计文件夹内的后代数量（不含自身）。
 *
 * 删除只提升直接子项，深层子树原样保留，因此确认文案需要同时给出
 * 递归数量与「不级联」的范围说明。
 */
export function folderContentsStats(
  folders: readonly Folder[],
  shortcuts: readonly Shortcut[],
  folderId: string,
): FolderContentsStats {
  const childrenByParent = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const siblings = childrenByParent.get(folder.parentId) ?? [];
    siblings.push(folder.id);
    childrenByParent.set(folder.parentId, siblings);
  }
  const shortcutsByFolder = new Map<string, number>();
  for (const shortcut of shortcuts) {
    if (shortcut.folderId === null) continue;
    shortcutsByFolder.set(shortcut.folderId, (shortcutsByFolder.get(shortcut.folderId) ?? 0) + 1);
  }
  const visited = new Set<string>([folderId]);
  const queue = [folderId];
  let folderCount = 0;
  let shortcutCount = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    shortcutCount += shortcutsByFolder.get(current) ?? 0;
    for (const childId of childrenByParent.get(current) ?? []) {
      if (visited.has(childId)) continue;
      visited.add(childId);
      folderCount += 1;
      queue.push(childId);
    }
  }
  return { folders: folderCount, shortcuts: shortcutCount };
}
