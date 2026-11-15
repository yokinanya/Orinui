import { useEffect, useState } from 'react';

import { useBookmarks } from '@/app/bookmark-context';
import type { BookmarkFolderRequest, BookmarkViewSnapshot } from '@/features/bookmarks/bookmark-view';
import { BookmarkFolderDialog } from '@/features/bookmarks/BookmarkFolderDialog';

/**
 * 判断当前快照是否允许渲染收藏夹内容。
 *
 * 关闭功能、撤销权限或尚未授权时不渲染任何节点；`stale` 仍保留可读内容（逐项标注
 * 「上次读取」）。这里只做只读状态判断，不读取浏览器 API。
 */
export function canRenderBookmarkContent(snapshot: BookmarkViewSnapshot): boolean {
  if (!snapshot.enabled) return false;
  if (snapshot.permission !== 'granted') return false;
  return snapshot.status === 'ready' || snapshot.status === 'stale' || snapshot.status === 'importing';
}

/**
 * 决定外部请求是否值得消费。
 *
 * 纯函数：同一 `requestId` 只返回一次目标；提供方每次给出新数组或新快照时
 * `request` 对象会变，但 `requestId` 不变，因此不会重复打开。返回 `null` 表示忽略。
 */
export function nextExternalFolderRequest(
  handledRequestId: number | null,
  request: BookmarkFolderRequest | null,
): BookmarkFolderRequest | null {
  if (!request) return null;
  if (handledRequestId === request.requestId) return null;
  return request;
}

/** 宿主内部的弹层会话状态：已消费的请求与当前打开目标。 */
export interface BookmarkFolderHostState {
  readonly handledRequestId: number | null;
  readonly target: BookmarkFolderRequest | null;
}

/**
 * 宿主状态推进（纯函数，便于直接断言）。
 *
 * - 不可读（关闭/撤销/读取中/失败）时立即作废弹层：`target` 清空，同时把当前挂起的
 *   请求记为已消费。这样重新启用后同一个旧 `requestId` 不会自动重开弹层；
 *   只有新的 `requestId` 才会再次打开。
 * - 可读时按 `requestId` 去重消费，重复的快照数组不会重复打开。
 */
export function nextFolderHostState(
  state: BookmarkFolderHostState,
  request: BookmarkFolderRequest | null,
  readable: boolean,
): BookmarkFolderHostState {
  if (!readable) {
    const handledRequestId = request?.requestId ?? state.handledRequestId;
    if (state.target === null && handledRequestId === state.handledRequestId) return state;
    return { handledRequestId, target: null };
  }
  if (!request) return state.target === null ? state : { ...state, target: null };
  if (request.requestId === state.handledRequestId) return state;
  return { handledRequestId: request.requestId, target: request };
}

/**
 * 外部搜索请求的文件夹弹层宿主。
 *
 * 主页区域只在布局未隐藏时挂载，因此「区域被布局隐藏但仍可搜索」需要一个不依赖区域
 * 是否渲染的消费者。本组件是 `snapshot.folderRequest` 的**唯一**消费者：
 *
 * - 只在启用且已授权（`canRenderBookmarkContent`）时渲染弹层；关闭或撤权后立即卸载，
 *   不保留任何书签标题。
 * - 每个 `requestId` 只消费一次：提供方每次给出新数组或新快照都不会重复打开。
 * - 根节点与任意层文件夹都接受；目标已失效（删除/隐藏）时弹层安全回退到全部根，
 *   不猜测替代目标。
 *
 * 区域内点击仍走区域自己的内存状态，不经过本组件，因此不会出现两个弹层。
 */
export function BookmarkFolderHost() {
  const bookmarks = useBookmarks();
  const [state, setState] = useState<BookmarkFolderHostState>({ handledRequestId: null, target: null });
  const snapshot = bookmarks?.snapshot;
  const request = snapshot?.folderRequest ?? null;
  const readable = snapshot ? canRenderBookmarkContent(snapshot) : false;

  // 同步推进：状态门控在渲染路径上先判断，不可读时绝不渲染旧 target；
  // effect 只负责把状态收敛（作废旧会话 / 消费新请求），不会造成旧内容闪回。
  useEffect(() => {
    setState((current) => nextFolderHostState(current, request, readable));
  }, [request, readable]);

  const shown = nextFolderHostState(state, request, readable);
  if (!bookmarks || !snapshot) return null;
  if (!readable) return null;
  if (!shown.target) return null;

  return (
    <BookmarkFolderDialog
      key={shown.target.requestId}
      bookmarks={bookmarks}
      open
      initialFolderId={shown.target.nodeId}
      onOpenChange={(next) => {
        if (next) return;
        setState((current) => ({ ...current, target: null }));
      }}
    />
  );
}
