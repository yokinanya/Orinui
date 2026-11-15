import type { Shortcut } from '@/domain/shortcut';

/** 当前层网站的读取结果；`idle` 表示尚未开始读取，与加载中一样不能当作空文件夹。 */
export type FolderShortcutRead =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly shortcuts: Shortcut[] }
  | { readonly status: 'error'; readonly message: string };

/** 内容区应展示的形态；只有成功读取且确实为空才是 `empty`。 */
export type FolderBodyKind = 'loading' | 'error' | 'empty' | 'content';

/**
 * 判定内容区形态。
 *
 * 读取未完成或失败时绝不能落到 `empty`：否则会把「读不到」伪装成「没有内容」，
 * 用户会以为文件夹真的空了。文件夹格子来自已同步的 folders，可以独立于网站读取渲染。
 */
export function folderBodyKind(state: FolderShortcutRead, childCount: number): FolderBodyKind {
  if (state.status === 'error') return 'error';
  if (state.status !== 'ready') return 'loading';
  return state.shortcuts.length === 0 && childCount === 0 ? 'empty' : 'content';
}

/** 弹层描述文案：未读到网站时只报文件夹数量，不用 0 个网站冒充结果。 */
export function folderReadDescription(state: FolderShortcutRead, childCount: number): string {
  if (state.status === 'ready') return `${state.shortcuts.length} 个网站 · ${childCount} 个文件夹`;
  const suffix = state.status === 'error' ? ' · 网站读取失败' : ' · 正在读取网站…';
  return `${childCount} 个文件夹${suffix}`;
}
