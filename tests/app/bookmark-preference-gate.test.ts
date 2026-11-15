import { describe, expect, it, vi } from 'vitest';

import {
  createBookmarkPreferenceGate,
  reconcileBookmarkPreferences,
  type BookmarkPreferenceOrigin,
} from '@/app/bookmark-preference-gate';
import { createDefaultBookmarkPreferences, type BookmarkPreferences } from '@/domain/bookmark-preferences';

function preferences(overrides: Partial<BookmarkPreferences> = {}): BookmarkPreferences {
  return { ...createDefaultBookmarkPreferences(), ...overrides };
}

function harness(current: BookmarkPreferences) {
  const gate = createBookmarkPreferenceGate(current);
  const applied: BookmarkPreferences[] = [];
  const interrupted: number[] = [];
  let mark = 0;
  return {
    gate,
    accept(next: BookmarkPreferences, origin: BookmarkPreferenceOrigin) {
      const changed = reconcileBookmarkPreferences({
        gate,
        next,
        origin,
        applySource: (nextPreferences) => { applied.push(nextPreferences); },
        interruptEnable: () => { mark += 1; interrupted.push(mark); },
        onError: () => {},
      });
      return { changed, applied: [...applied], interrupted: [...interrupted], canonical: gate.current() };
    },
  };
}

describe('书签偏好门控', () => {
  it('观察器首次投递 false 不打断首次授权，也不应用', () => {
    const test = harness(preferences({ enabled: false }));
    const result = test.accept(preferences({ enabled: false }), 'observer');
    expect(result.interrupted).toEqual([]);
    expect(result.applied).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it('观察器首次投递 true 只应用一次，重复投递不再触碰数据源', () => {
    const test = harness(preferences({ enabled: false }));
    const first = test.accept(preferences({ enabled: true }), 'observer');
    expect(first.applied).toEqual([preferences({ enabled: true })]);
    expect(first.interrupted).toEqual([]);

    const second = test.accept(preferences({ enabled: true }), 'observer');
    expect(second.applied).toEqual([preferences({ enabled: true })]);
    expect(second.interrupted).toEqual([]);
    expect(second.changed).toBe(false);
  });

  it('观察到的 true → false 打断本页在途授权，并清空数据源', () => {
    const test = harness(preferences({ enabled: false }));
    // 观察器先看到他页启用提交。
    test.accept(preferences({ enabled: true }), 'observer');
    // 再看到他页关闭提交：这是真实可见的 true → false。
    const result = test.accept(preferences({ enabled: false }), 'observer');
    // 打断只发生一次：这是 provider 用于作废 enableToken 的唯一信号。
    expect(result.interrupted).toEqual([1]);
    expect(result.applied).toEqual([preferences({ enabled: true }), preferences({ enabled: false })]);
    expect(result.canonical.enabled).toBe(false);

    // 同一关闭值重复投递不得再次打断或再写数据源。
    const repeated = test.accept(preferences({ enabled: false }), 'observer');
    expect(repeated.interrupted).toEqual([1]);
    expect(repeated.applied).toEqual([preferences({ enabled: true }), preferences({ enabled: false })]);
    expect(repeated.changed).toBe(false);
  });

  it('挂载时已启用、首次观察即为关闭，也作废在途授权（关闭发生在挂载与观察之间）', () => {
    const test = harness(preferences({ enabled: true }));
    const result = test.accept(preferences({ enabled: false }), 'observer');
    expect(result.interrupted).toEqual([1]);
    expect(result.canonical.enabled).toBe(false);
    // 重复投递不重复打断。
    expect(test.accept(preferences({ enabled: false }), 'observer').interrupted).toEqual([1]);
  });

  it('观察器给出权威值后，旧 data.settings 快照不能回滚 canonical', () => {
    const test = harness(preferences({ enabled: false }));
    // 观察器首次给出启用值（他页启用）。
    test.accept(preferences({ enabled: true }), 'observer');
    // 另一页关闭提交：观察器先到。
    test.accept(preferences({ enabled: false }), 'observer');
    // 本页无关重渲染带着旧的 `enabled: true` settings 快照回来，不得复活。
    const stale = test.accept(preferences({ enabled: true }), 'settings');
    expect(stale.canonical.enabled).toBe(false);
    expect(stale.changed).toBe(false);
    expect(stale.applied).toEqual([preferences({ enabled: true }), preferences({ enabled: false })]);
  });

  it('本页设置回声与最近一次观察值一致时被接受，不会重复写数据源', () => {
    const test = harness(preferences({ enabled: false }));
    test.accept(preferences({ enabled: true }), 'observer');
    const echo = test.accept(preferences({ enabled: true }), 'settings');
    expect(echo.changed).toBe(false);
    expect(echo.applied).toEqual([preferences({ enabled: true })]);
  });

  it('showInSearch 只更新界面 canonical，不触发数据源写入', () => {
    const test = harness(preferences({ enabled: true, showInSearch: true }));
    const result = test.accept(preferences({ enabled: true, showInSearch: false }), 'settings');
    expect(result.applied).toEqual([]);
    expect(result.canonical.showInSearch).toBe(false);
    expect(result.changed).toBe(true);
  });

  it('模式与隐藏规则变化都触达数据源，并保留 showInSearch', () => {
    const gate = createBookmarkPreferenceGate(preferences({ enabled: true }));
    const applied: BookmarkPreferences[] = [];
    reconcileBookmarkPreferences({
      gate,
      next: preferences({ enabled: true, showInSearch: false, mode: 'folder' }),
      origin: 'settings',
      applySource: (next) => { applied.push(next); },
      interruptEnable: () => { throw new Error('不应打断'); },
      onError: () => {},
    });
    expect(applied).toEqual([preferences({ enabled: true, showInSearch: false, mode: 'folder' })]);
    expect(gate.current().showInSearch).toBe(false);
    expect(gate.current().mode).toBe('folder');
  });

  it('数据源应用失败交给显式回调，不吞掉', () => {
    const gate = createBookmarkPreferenceGate(preferences({ enabled: false }));
    const error = new Error('应用偏好失败');
    const onError = vi.fn();
    reconcileBookmarkPreferences({
      gate,
      next: preferences({ enabled: true }),
      origin: 'settings',
      applySource: () => { throw error; },
      interruptEnable: () => {},
      onError,
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('异步 applyPreferences 拒绝也经 onError 上报，不伪成功', async () => {
    const gate = createBookmarkPreferenceGate(preferences({ enabled: false }));
    const error = new Error('apply rejected');
    const onError = vi.fn();
    reconcileBookmarkPreferences({
      gate,
      next: preferences({ enabled: true }),
      origin: 'settings',
      applySource: async () => { throw error; },
      interruptEnable: () => {},
      onError,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledWith(error);
  });
});
