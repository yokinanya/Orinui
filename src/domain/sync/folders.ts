import { fail } from '@/domain/errors';

/**
 * 文件夹祖先解析（只读）。
 *
 * 删除自有文件夹只产生**那一个**文件夹的墓碑，后代寄存器的 `parentId` 仍指向已删节点。
 * 要让任何设备都能重建「最近存活祖先」，墓碑必须携带被删文件夹当时的父层引用；
 * 这里集中解析该链路，供接收校验与物化共用，避免两边结论分叉。
 *
 * 旧墓碑没有父引用元数据时明确按主页（`null`）处理，不猜测、不改写任何寄存器。
 */
export interface FolderParentSource {
  readonly id: string;
  readonly parentId: string | null;
}

/** 文件夹墓碑携带的父层引用：键是被删文件夹标识。 */
export type DeletedFolderParents = ReadonlyMap<string, string | null>;

/** 从墓碑列表提取文件夹父层引用；只有文件夹墓碑参与，其余类型忽略。 */
export function folderTombstoneParents(
  tombstones: readonly { readonly entityType: string; readonly id: string; readonly parentId?: string | null }[],
): DeletedFolderParents {
  const parents = new Map<string, string | null>();
  for (const tombstone of tombstones) {
    if (tombstone.entityType !== 'folder') continue;
    // 缺省是 legacy 元数据，按主页处理；已写入的父文件夹 ID 原样保留。
    parents.set(tombstone.id, tombstone.parentId ?? null);
  }
  return parents;
}

/**
 * 从某个文件夹的寄存器父引用上溯到最近存活祖先。
 *
 * - 父节点存活：返回它；
 * - 父节点已删：继续上溯它的墓碑父引用；
 * - 墓碑没有元数据（legacy）：回到主页；
 * - 父节点既非存活也无墓碑：父引用不存在；
 * - 链路回到起点：成环。
 */
export function resolveSurvivingParent(
  folder: FolderParentSource,
  live: ReadonlySet<string>,
  deleted: DeletedFolderParents,
): string | null {
  const seen = new Set<string>([folder.id]);
  let current = folder.parentId;
  while (current !== null) {
    if (seen.has(current)) fail('文件夹父引用成环');
    seen.add(current);
    if (live.has(current)) return current;
    if (!deleted.has(current)) fail('文件夹父引用不存在');
    current = deleted.get(current) ?? null;
  }
  return null;
}

/** 每个存活文件夹的物化父引用（最近存活祖先或主页）。 */
export function resolveFolderParents(
  folders: readonly FolderParentSource[],
  deleted: DeletedFolderParents,
): Map<string, string | null> {
  const live = new Set(folders.map(({ id }) => id));
  const resolved = new Map<string, string | null>();
  for (const folder of folders) resolved.set(folder.id, resolveSurvivingParent(folder, live, deleted));
  return resolved;
}

/**
 * 网站所属文件夹的物化落点。
 *
 * 存活文件夹原样保留；指向已删文件夹时沿墓碑父引用上溯到最近存活祖先。校验阶段已保证
 * 引用要么存活要么有墓碑，这里不做猜测；只产出投影结果，不改写 placement 寄存器。
 */
export function resolveFolderPlacement(
  folderId: string | null,
  live: ReadonlySet<string>,
  deleted: DeletedFolderParents,
): string | null {
  if (folderId === null || live.has(folderId)) return folderId;
  if (!deleted.has(folderId)) return null;
  return resolveSurvivingParent({ id: folderId, parentId: deleted.get(folderId) ?? null }, live, deleted);
}

/**
 * 校验墓碑自身的父引用链：只允许指向存活文件夹或另一个文件夹墓碑。
 *
 * 直接拒绝成环与悬空引用，不靠物化兜底；legacy 墓碑（父引用为 `null`）天然合法。
 */
export function validateDeletedFolderParents(deleted: DeletedFolderParents, live: ReadonlySet<string>): void {
  for (const id of deleted.keys()) {
    const seen = new Set<string>([id]);
    let current = deleted.get(id) ?? null;
    while (current !== null) {
      if (seen.has(current)) fail('文件夹父引用成环');
      seen.add(current);
      if (live.has(current)) break;
      if (!deleted.has(current)) fail('文件夹父引用不存在');
      current = deleted.get(current) ?? null;
    }
  }
}
