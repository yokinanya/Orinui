import { describe, expect, it } from 'vitest';

import { pendingFocusOutcome } from '@/features/folders/folder-focus';

const WORK = 'work';
const PROJECT = 'project';

/** 默认场景：从「工作/项目」返回「工作」，内容区已读取完成并渲染出「项目」格子。 */
function outcome(input: {
  readonly pendingFocus?: string | null;
  readonly currentId?: string;
  readonly contentFolderId?: string | null;
  readonly status?: 'idle' | 'loading' | 'ready' | 'error';
  readonly renderedTileIds?: readonly string[];
}) {
  return pendingFocusOutcome({
    pendingFocus: input.pendingFocus === undefined ? PROJECT : input.pendingFocus,
    currentId: input.currentId ?? WORK,
    content: { folderId: input.contentFolderId ?? WORK, status: input.status ?? 'ready' },
    renderedTileIds: input.renderedTileIds ?? [PROJECT],
  });
}

/**
 * 返回上一层后恢复焦点：读取当前层网站的异步过程会把内容区换成占位，
 * 在占位到达前聚焦刚渲染的格子，格子会立刻卸载、焦点掉回弹层且再也回不来。
 */
describe('pendingFocusOutcome 只在内容区回到当前层并结束读取后才恢复焦点', () => {
  it('本层读取成功且目标格子已挂载时聚焦该格子', () => {
    expect(outcome({})).toEqual({ kind: 'focus', folderId: PROJECT });
  });

  it('本层还在读取时等待，不在稍后会被占位替换的内容上聚焦', () => {
    expect(outcome({ status: 'loading' })).toEqual({ kind: 'wait' });
  });

  it('内容区仍是上一层的旧结果时等待：这一帧的格子马上会被 loading 占位卸载', () => {
    // 返回「工作」后、新的读取结果到达前，内容区仍是「项目」层读到的数据。
    expect(outcome({ contentFolderId: PROJECT, status: 'ready' })).toEqual({ kind: 'wait' });
    // 弹层刚打开、尚未开始读取时同理：还不能在旧内容上消费待恢复焦点。
    expect(outcome({ contentFolderId: null, status: 'idle' })).toEqual({ kind: 'wait' });
  });

  it('读取结束后目标格子不在 DOM 时退到返回按钮，而不是静默丢弃', () => {
    expect(outcome({ renderedTileIds: [] })).toEqual({ kind: 'fallback' });
    expect(outcome({ renderedTileIds: ['other'] })).toEqual({ kind: 'fallback' });
  });

  it('读取失败也算结束：仍要交出焦点，不能让 pendingFocus 永久悬挂', () => {
    expect(outcome({ status: 'error', renderedTileIds: [] })).toEqual({ kind: 'fallback' });
  });

  it('没有待恢复的焦点时不做任何事', () => {
    expect(outcome({ pendingFocus: null })).toEqual({ kind: 'wait' });
  });
});
