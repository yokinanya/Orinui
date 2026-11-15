import { describe, expect, it, vi } from 'vitest';

import { createBookmarkCache, BOOKMARK_CACHE_KEY, type BookmarkCacheArea } from '@/platform/bookmark-cache';
import { BookmarkUnsupportedError } from '@/platform/bookmarks';
import { normalizeBookmarkTree, type RawBookmarkNode } from '@/domain/browser-bookmarks';

function tree(): ReturnType<typeof normalizeBookmarkTree> {
  const raw: RawBookmarkNode = {
    id: 'menu________',
    title: '书签菜单',
    type: 'folder',
    children: [
      { id: 'l1', parentId: 'menu________', title: '一', url: 'https://one.example/' },
      { id: 's1', parentId: 'menu________', type: 'separator' },
    ],
  };
  return normalizeBookmarkTree([raw]);
}

interface FakeArea extends BookmarkCacheArea {
  readonly data: Map<string, unknown>;
  readonly setCalls: unknown[];
  readonly removeCalls: unknown[];
}

function fakeArea(initial?: unknown): FakeArea {
  const data = new Map<string, unknown>();
  if (initial !== undefined) data.set(BOOKMARK_CACHE_KEY, initial);
  const setCalls: unknown[] = [];
  const removeCalls: unknown[] = [];
  return {
    data,
    setCalls,
    removeCalls,
    async get(key) {
      return data.has(key) ? { [key]: data.get(key) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) {
        setCalls.push({ key, value });
        data.set(key, value);
      }
    },
    async remove(key) {
      removeCalls.push(key);
      data.delete(key);
    },
  };
}

const extension = () => true;

describe('createBookmarkCache 运行环境', () => {
  it('普通网页预览读写都抛 unsupported', async () => {
    const cache = createBookmarkCache({ area: fakeArea(), isExtension: () => false });
    await expect(cache.read()).rejects.toBeInstanceOf(BookmarkUnsupportedError);
    await expect(cache.write(tree(), 1)).rejects.toBeInstanceOf(BookmarkUnsupportedError);
    await expect(cache.clear(1)).rejects.toBeInstanceOf(BookmarkUnsupportedError);
  });
});

describe('写入与读取', () => {
  it('写入后可按原结构读回，路径逐段保留', async () => {
    const area = fakeArea();
    const cache = createBookmarkCache({ area, isExtension: extension, now: () => 1234 });

    await expect(cache.write(tree(), 1)).resolves.toBe(true);
    const cached = await cache.read();
    expect(cached?.readAt).toBe(1234);
    expect(cached?.tree.roots[0]?.children.map((node) => node.path)).toEqual([
      ['书签菜单', '一'],
      ['书签菜单', ''],
    ]);
    expect(cached?.tree.roots[0]?.children[1]?.kind).toBe('separator');
  });

  it('只使用专用 storage.local 键', async () => {
    const area = fakeArea();
    const cache = createBookmarkCache({ area, isExtension: extension });
    await cache.write(tree(), 1);
    expect(area.setCalls).toEqual([{ key: BOOKMARK_CACHE_KEY, value: expect.objectContaining({ version: 1 }) }]);
    expect(area.setCalls).toHaveLength(1);
  });

  it('未写入时读取返回 null，而不是空树', async () => {
    const cache = createBookmarkCache({ area: fakeArea(), isExtension: extension });
    await expect(cache.read()).resolves.toBeNull();
  });

  it('缓存路径与祖先标题不一致时明确失败，不返回半份树', async () => {
    const corrupted = JSON.parse(JSON.stringify({ version: 1, tree: tree(), readAt: 99 })) as {
      tree: { roots: { children: { path: string[] }[] }[] };
    };
    corrupted.tree.roots[0]!.children[0]!.path = ['别的根', '一'];
    const cache = createBookmarkCache({ area: fakeArea(corrupted), isExtension: extension });
    await expect(cache.read()).rejects.toThrowError(/路径与祖先标题不一致/);
  });

  it('未知版本与非对象缓存明确失败', async () => {
    const badVersion = createBookmarkCache({
      area: fakeArea({ version: 2, tree: tree(), readAt: 1 }),
      isExtension: extension,
    });
    await expect(badVersion.read()).rejects.toThrowError(/版本未知/);
    const notObject = createBookmarkCache({ area: fakeArea('x'), isExtension: extension });
    await expect(notObject.read()).rejects.toThrowError(/不是对象/);
  });
});

describe('代次门控', () => {
  it('clear 之后的旧代次写入被拒绝，且不会把旧树写回', async () => {
    const area = fakeArea();
    const cache = createBookmarkCache({ area, isExtension: extension });

    await cache.write(tree(), 3);
    await cache.clear(5);
    expect(area.data.has(BOOKMARK_CACHE_KEY)).toBe(false);

    await expect(cache.write(tree(), 4)).resolves.toBe(false);
    expect(area.data.has(BOOKMARK_CACHE_KEY)).toBe(false);
    await expect(cache.read()).resolves.toBeNull();
  });

  it('新一代次写入仍被接受', async () => {
    const area = fakeArea();
    const cache = createBookmarkCache({ area, isExtension: extension });
    await cache.clear(2);
    await expect(cache.write(tree(), 3)).resolves.toBe(true);
    await expect(cache.read()).resolves.not.toBeNull();
  });

  it('已进入 storage.set 的写入一定先于后续清空落地', async () => {
    const area = fakeArea();
    const order: string[] = [];
    const gate: { release: () => void } = { release: () => {} };
    const setGate = new Promise<void>((resolve) => { gate.release = resolve; });
    const set = area.set.bind(area);
    const remove = area.remove.bind(area);
    area.set = async (items) => {
      order.push('set:start');
      await setGate;
      await set(items);
      order.push('set:end');
    };
    area.remove = async (key) => { order.push('remove'); await remove(key); };

    const cache = createBookmarkCache({ area, isExtension: extension });
    const writing = cache.write(tree(), 1);
    // 让写操作真正进入 storage.set，此时再请求清空。
    await Promise.resolve();
    await Promise.resolve();
    const clearing = cache.clear(2);
    gate.release();
    await Promise.all([writing, clearing]);

    expect(order).toEqual(['set:start', 'set:end', 'remove']);
    expect(area.data.has(BOOKMARK_CACHE_KEY)).toBe(false);
  });

  it('排队期间发生清空时，尚未执行的写入直接失败', async () => {
    const area = fakeArea();
    const cache = createBookmarkCache({ area, isExtension: extension });

    const first = cache.write(tree(), 1);
    const clearing = cache.clear(2);
    const late = cache.write(tree(), 1);
    await Promise.all([first, clearing]);
    await expect(late).resolves.toBe(false);
  });

  it('minimumGeneration 反映最新清空代次', async () => {
    const cache = createBookmarkCache({ area: fakeArea(), isExtension: extension });
    expect(cache.minimumGeneration()).toBe(0);
    void cache.clear(7);
    expect(cache.minimumGeneration()).toBe(7);
  });
});

describe('存储访问级别', () => {
  it('Chrome 提供 setAccessLevel 时调用它', async () => {
    const area = fakeArea();
    const setAccessLevel = vi.fn().mockResolvedValue(undefined);
    area.setAccessLevel = setAccessLevel;
    const cache = createBookmarkCache({ area, isExtension: extension });

    await cache.write(tree(), 1);
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('Firefox 缺少 setAccessLevel 时跳过而不失败', async () => {
    const area = fakeArea();
    const cache = createBookmarkCache({ area, isExtension: extension });
    await expect(cache.write(tree(), 1)).resolves.toBe(true);
  });

  it('存储失败原样上抛，不伪报写入成功', async () => {
    const area = fakeArea();
    const failure = new Error('quota exceeded');
    area.set = vi.fn().mockRejectedValue(failure);
    const cache = createBookmarkCache({ area, isExtension: extension });
    await expect(cache.write(tree(), 1)).rejects.toBe(failure);
  });
});

describe('subscribe', () => {
  function source() {
    const listeners = new Set<(changes: Record<string, { newValue?: unknown }>, area: string) => void>();
    return {
      listeners,
      addListener: (listener: (typeof listeners extends Set<infer T> ? T : never)) => listeners.add(listener),
      removeListener: (listener: (typeof listeners extends Set<infer T> ? T : never)) => listeners.delete(listener),
      emit(changes: Record<string, { newValue?: unknown }>, area = 'local') {
        for (const listener of [...listeners]) listener(changes, area);
      },
    };
  }

  it('其他上下文清空键时上报 removed', () => {
    const changes = source();
    const cache = createBookmarkCache({ area: fakeArea(), onChanged: changes, isExtension: extension });
    const listener = vi.fn();
    cache.subscribe(listener);

    changes.emit({ [BOOKMARK_CACHE_KEY]: { newValue: undefined } });
    expect(listener).toHaveBeenCalledWith({ removed: true, value: null });
  });

  it('其他存储区与无关键被忽略', () => {
    const changes = source();
    const cache = createBookmarkCache({ area: fakeArea(), onChanged: changes, isExtension: extension });
    const listener = vi.fn();
    cache.subscribe(listener);

    changes.emit({ [BOOKMARK_CACHE_KEY]: { newValue: undefined } }, 'sync');
    changes.emit({ unrelated: { newValue: 1 } });
    expect(listener).not.toHaveBeenCalled();
  });

  it('损坏的新值不会上抛，只报告缓存不可信', () => {
    const changes = source();
    const cache = createBookmarkCache({ area: fakeArea(), onChanged: changes, isExtension: extension });
    const listener = vi.fn();
    cache.subscribe(listener);

    changes.emit({ [BOOKMARK_CACHE_KEY]: { newValue: { version: 9 } } });
    expect(listener).toHaveBeenCalledWith({ removed: false, value: null });
  });

  it('合法新值解析为缓存结果，dispose 后不再回调', () => {
    const changes = source();
    const cache = createBookmarkCache({
      area: fakeArea(),
      onChanged: changes,
      isExtension: extension,
      now: () => 42,
    });
    const listener = vi.fn();
    const stop = cache.subscribe(listener);

    changes.emit({ [BOOKMARK_CACHE_KEY]: { newValue: { version: 1, tree: tree(), readAt: 42 } } });
    expect(listener).toHaveBeenCalledWith({ removed: false, value: expect.objectContaining({ readAt: 42 }) });

    stop();
    expect(changes.listeners.size).toBe(0);
  });
});
