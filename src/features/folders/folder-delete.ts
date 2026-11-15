import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { folderContentsStats, type FolderContentsStats } from '@/features/folders/folder-path';

/** 删除确认所需的计数：递归总数用于说明深层保留，直接子项用于说明提升范围。 */
export interface DeleteSummary extends FolderContentsStats {
  readonly childFolders: number;
  readonly directShortcuts: number;
}

/** 一次统计结果；直接子项与递归统计必须来自同一份快照，避免两个列表漂移。 */
export function summarizeDelete(
  folders: readonly Folder[],
  shortcuts: readonly Shortcut[],
  folderId: string,
): DeleteSummary {
  return {
    ...folderContentsStats(folders, shortcuts, folderId),
    childFolders: folders.filter((item) => item.parentId === folderId).length,
    directShortcuts: shortcuts.filter((item) => item.folderId === folderId).length,
  };
}

export interface DeleteDescriptionInput {
  readonly name: string;
  /** 提升目标的界面称谓：顶层是「主页」，否则「上一级文件夹」。 */
  readonly target: string;
  readonly summary: DeleteSummary | null;
  readonly statsError: string | null;
}

/**
 * 删除确认文案。
 *
 * 三种状态互斥：统计中、统计失败、拿到结果。失败时绝不显示进度或过期计数，
 * 否则用户会在未知影响下确认破坏性操作。
 */
export function deleteFolderDescription(input: DeleteDescriptionInput): string {
  if (input.statsError !== null) {
    return `统计失败，无法确认删除范围：${input.statsError}。可以重试；在拿到统计结果前不会启用删除。`;
  }
  const { summary } = input;
  if (summary === null) return '正在统计文件夹内容…';

  const deeperFolders = summary.folders - summary.childFolders;
  const deeperShortcuts = summary.shortcuts - summary.directShortcuts;
  // 只说明直接子项被提升；更深层用一句「保持原样、随父级上移一层」概括，不暗示会连带删除。
  const deeper = deeperFolders > 0
    ? `更深层的 ${deeperFolders} 个子文件夹和 ${deeperShortcuts} 个网站继续留在各自所属的子文件夹里，随父级整体上移一层，内容与标识都不变。`
    : deeperShortcuts > 0
      ? `更深层的 ${deeperShortcuts} 个网站继续留在子文件夹里，随父级整体上移一层，内容与标识都不变。`
      : '';
  return `只会删除「${input.name}」这一层，不会连带删除里面的内容。它直接的 ${summary.directShortcuts} 个网站和 ${summary.childFolders} 个子文件夹会按原相对顺序追加到${input.target}已有内容之后，名称与标识保持不变。${deeper}${input.target}原有内容不移动，其他层级也不会重排或重新编号。此操作不能撤销。`;
}

/** 只有拿到本次统计结果、且不在删除中时才允许确认；失败或统计中一律禁用。 */
export function canConfirmDelete(input: { readonly summary: DeleteSummary | null;
  readonly busy: boolean; readonly statsError: string | null }): boolean {
  return !input.busy && input.statsError === null && input.summary !== null;
}
