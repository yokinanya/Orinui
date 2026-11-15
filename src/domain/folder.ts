import { fail } from '@/domain/errors';

/**
 * 自有文件夹。
 *
 * 主页网格里只有顶层文件夹（`parentId === null`）与网站并列占一个格子；嵌套文件夹
 * 只存在于父容器内。文件夹可任意嵌套，但不提供移动、改父或同层重排：只能在当前层
 * 新建、重命名和删除；删除时直接子文件夹与直接网站提升到父层并保留后代子树。
 */
export interface Folder {
  id: string;
  /** 父文件夹；null 表示主页顶层。 */
  parentId: string | null;
  name: string;
  /** 同一父容器内的顺序；创建时追加，删除提升时追加到末尾。 */
  order: number;
}

export interface FolderTreeInput {
  readonly id: string;
  readonly parentId: string | null;
}

/** 规范化后的错误文案复用同一处，避免本地、同步和备份给出不同结论。 */
const MISSING_PARENT = '文件夹父引用不存在';
const CYCLE = '文件夹父引用成环';
const SELF_PARENT = '文件夹不能作为自己的父文件夹';

/**
 * 校验文件夹树的父引用：父必须存在（或为 null），不允许自引用或成环。
 *
 * 领域边界（本地写入、同步接收、ZIP 导入）都调用同一函数，任何一边失败都不写入，
 * 不静默把后代折叠到主页。
 */
export function assertFolderTree(folders: readonly FolderTreeInput[]): void {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  if (byId.size !== folders.length) fail('文件夹标识不能重复');
  for (const folder of folders) validateFolderParent(folder, byId);
}

function validateFolderParent(folder: FolderTreeInput, byId: ReadonlyMap<string, FolderTreeInput>): void {
  if (folder.parentId === null) return;
  if (folder.parentId === folder.id) fail(SELF_PARENT);
  const seen = new Set<string>([folder.id]);
  let parentId: string | null = folder.parentId;
  while (parentId !== null) {
    if (seen.has(parentId)) fail(CYCLE);
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) fail(MISSING_PARENT);
    parentId = parent.parentId;
  }
}

/** 顶层文件夹才进入主页格位。 */
export function isRootFolder(folder: Pick<Folder, 'parentId'>): boolean {
  return folder.parentId === null;
}

/**
 * 从根到目标的文件夹路径（含目标本身）。
 *
 * 供搜索详情与面包屑使用；父引用缺失时返回已能确认的部分，不做猜测。
 */
export function folderPath(folders: readonly Folder[], folderId: string): Folder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const path: Folder[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return path;
}
