import type { FolderShortcutRead } from '@/features/folders/folder-read';

/** 待恢复焦点的处置结果：等待下一帧、落到目标格子、或退到返回按钮。 */
export type PendingFocusOutcome =
  | { readonly kind: 'wait' }
  | { readonly kind: 'focus'; readonly folderId: string }
  | { readonly kind: 'fallback' };

export interface PendingFocusInput {
  readonly pendingFocus: string | null;
  readonly currentId: string;
  /** 内容区当前展示的读取结果，以及它属于哪一层；切换层级到新结果到达之间仍是上一层。 */
  readonly content: { readonly folderId: string | null; readonly status: FolderShortcutRead['status'] };
  readonly renderedTileIds: readonly string[];
}

/**
 * 决定「返回上一层后恢复焦点」这一帧该做什么。
 *
 * 切换层级会重新读取当前层网站，内容区在结果到达前是加载占位；此时刚渲染出来的格子
 * 会被占位替换并卸载，焦点随之掉回弹层且不会再有第二次机会。因此只有内容区确实属于
 * 当前层、且读取已经结束（成功或失败）时才消费待恢复的焦点：
 * - 读取未结束或内容仍属于上一层：等待，不把焦点放在马上就要卸载的节点上；
 * - 读取结束后目标格子不在 DOM：退到返回按钮，键盘用户不会丢失位置；
 * - 读取失败同样算结束，避免待恢复焦点一直悬挂。
 */
export function pendingFocusOutcome(input: PendingFocusInput): PendingFocusOutcome {
  const { pendingFocus, currentId, content, renderedTileIds } = input;
  if (pendingFocus === null) return { kind: 'wait' };
  if (content.status === 'idle' || content.status === 'loading') return { kind: 'wait' };
  if (content.folderId !== currentId) return { kind: 'wait' };
  return renderedTileIds.includes(pendingFocus)
    ? { kind: 'focus', folderId: pendingFocus }
    : { kind: 'fallback' };
}
