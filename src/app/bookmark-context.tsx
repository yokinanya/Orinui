import { createContext, use, type ReactNode } from 'react';

import type { BookmarkContextValue, BookmarkViewSnapshot } from '@/features/bookmarks/bookmark-view';

/**
 * 浏览器收藏夹的 UI 上下文。
 *
 * 提供方由应用装配层实现，把控制器、偏好与缓存映射成 `BookmarkContextValue`；
 * 本文件只声明契约，不创建默认收藏夹、不读取浏览器 API、不注入示例数据。
 *
 * 没有提供方时：
 * - `useBookmarks()` 返回 `null`，可选消费者（主页区域、搜索）据此不渲染；
 * - `useBookmarksRequired()` 抛出明确错误，用于设置分区等必须接线的界面。
 *
 * `DISABLED_BOOKMARK_SNAPSHOT` 只是「功能关闭且无内容」的空状态，供区域在没有提供方时
 * 保持静默；它不是替代投影，任何界面都不得据此展示书签条目。
 */
export const BookmarkContext = createContext<BookmarkContextValue | null>(null);

export const DISABLED_BOOKMARK_SNAPSHOT: BookmarkViewSnapshot = Object.freeze({
  status: 'disabled',
  permission: 'unknown',
  enabled: false,
  mode: 'region',
  showInSearch: false,
  regionVisible: true,
  roots: Object.freeze([]),
  hiddenRules: Object.freeze([]),
  hiddenNodeIds: Object.freeze([]),
  ruleMatches: Object.freeze([]),
  error: null,
  actionError: null,
  readAt: null,
  busy: false,
  folderRequest: null,
});

/** 可选读取：没有提供方时返回 null，调用方自行决定隐藏或显示说明。 */
export function useBookmarks(): BookmarkContextValue | null {
  return use(BookmarkContext);
}

/** 必须接线：设置分区与隐藏管理器用它，缺失时立即失败而不是展示空收藏夹。 */
export function useBookmarksRequired(): BookmarkContextValue {
  const value = use(BookmarkContext);
  if (!value) throw new Error('浏览器收藏夹界面必须在 BookmarkContext 提供方内使用');
  return value;
}

/** 只读快照；没有提供方时回落到关闭空状态，避免主页区域伪造内容。 */
export function useBookmarkSnapshot(): BookmarkViewSnapshot {
  return use(BookmarkContext)?.snapshot ?? DISABLED_BOOKMARK_SNAPSHOT;
}

/**
 * 供应用装配层使用的提供方。
 *
 * 这里不做任何状态推导，只把已装配好的值传下去；动作实现属于提供方（控制器、
 * 偏好与缓存的所有者）。
 */
export function BookmarkContextProvider({ value, children }: {
  readonly value: BookmarkContextValue;
  readonly children: ReactNode;
}) {
  return <BookmarkContext value={value}>{children}</BookmarkContext>;
}
