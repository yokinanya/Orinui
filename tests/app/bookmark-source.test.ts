import { describe, expect, it, vi } from 'vitest';

import {
  createBookmarkSource,
  type BookmarkChangeSubscriptionLike,
  type BookmarkPlatformPort,
  type BookmarkSourcePreferences,
} from '@/app/bookmark-source';
import type { BookmarkCapability, BookmarkPermission, BookmarkPermissionChange } from '@/platform/bookmarks';
import type { BookmarkCache, BookmarkCacheArea, CachedBookmarkTree } from '@/platform/bookmark-cache';
import { BOOKMARK_CACHE_KEY, createBookmarkCache } from '@/platform/bookmark-cache';
import { createBookmarkPreferenceGate, reconcileBookmarkPreferences } from '@/app/bookmark-preference-gate';
import { normalizeBookmarkTree, type NormalizedBookmarkTree, type RawBookmarkNode } from '@/domain/browser-bookmarks';

// 装配层回归：不启动浏览器、不请求隔离世界的扩展 API；原生 storage 事件用内存端口替代。
vi.mock('wxt/browser', () => ({ browser: {} }));

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

function rawTree(): RawBookmarkNode[] {
  return [{
    id: '0',
    title: '',
    type: 'folder',
    children: [
      {
        id: '1',
        parentId: '0',
        title: '书签栏',
        type: 'folder',
        children: [
          { id: 'a', parentId: '1', title: '主页', url: 'https://a.example/' },
        ],
      },
    ],
  }];
}

function normalizedTree(): NormalizedBookmarkTree {
  return normalizeBookmarkTree(rawTree());
}

interface Harness {
  readonly source: ReturnType<typeof createBookmarkSource>;
  readonly platform: {
    capability: ReturnType<typeof vi.fn>;
    permission: ReturnType<typeof vi.fn>;
    requestPermission: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    subscribeChanges: ReturnType<typeof vi.fn>;
    subscribePermissionChanges: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    emitPermission(change: BookmarkPermissionChange): void;
    setPermission(next: BookmarkPermission): void;
    changeHandlers(): { changed: () => void; importingChanged: (importing: boolean) => void } | null;
    disposeChanges(): void;
  };
  readonly cache: {
    read: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    subscribe: ReturnType<typeof vi.fn>;
    stored(): CachedBookmarkTree | null;
    emitChange(change: { removed: boolean; value: CachedBookmarkTree | null }): void;
  };
  readonly timers: { pending(): number; flush(): void };
}

function harness(options: {
  capability?: BookmarkCapability;
  permission?: BookmarkPermission;
  initial?: Partial<BookmarkSourcePreferences>;
  cached?: CachedBookmarkTree | null;
  importEvents?: boolean;
  now?: () => number;
} = {}): Harness {
  let capability: BookmarkCapability = options.capability ?? 'available';
  let permission: BookmarkPermission = options.permission ?? 'granted';
  let cached: CachedBookmarkTree | null = options.cached ?? null;
  let changeSubscription: (BookmarkChangeSubscriptionLike & {
    handlers: { changed: () => void; importingChanged: (importing: boolean) => void };
  }) | null = null;
  let permissionListener: ((change: BookmarkPermissionChange) => void) | null = null;
  let cacheListener: ((change: { removed: boolean; value: CachedBookmarkTree | null }) => void) | null = null;
  const timers = new Map<number, () => void>();
  let timerId = 0;

  const platform: Harness['platform'] = {
    capability: vi.fn(() => capability),
    permission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => permission),
    read: vi.fn(async () => rawTree()),
    subscribeChanges: vi.fn((handlers: { changed: () => void; importingChanged: (importing: boolean) => void }) => {
      const subscription = {
        importEvents: options.importEvents ?? false,
        handlers,
        dispose: vi.fn(() => {
          if (changeSubscription === subscription) changeSubscription = null;
        }),
      };
      changeSubscription = subscription;
      return subscription;
    }),
    subscribePermissionChanges: vi.fn((listener: (change: BookmarkPermissionChange) => void) => {
      permissionListener = listener;
      return () => { permissionListener = null; };
    }),
    open: vi.fn(async () => {}),
    emitPermission(change) {
      permissionListener?.(change);
    },
    setPermission(next) {
      permission = next;
    },
    changeHandlers: () => changeSubscription?.handlers ?? null,
    disposeChanges: () => { changeSubscription?.dispose(); },
  };

  const cache: Harness['cache'] = {
    read: vi.fn(async () => cached),
    write: vi.fn(async (tree: NormalizedBookmarkTree, generation: number) => {
      if (generation <= 0) return false;
      cached = { version: 1, tree, readAt: (options.now ?? Date.now)() };
      return true;
    }),
    clear: vi.fn(async () => { cached = null; }),
    subscribe: vi.fn((listener: (change: { removed: boolean; value: CachedBookmarkTree | null }) => void) => {
      cacheListener = listener;
      return () => { cacheListener = null; };
    }),
    stored: () => cached,
    emitChange(change) {
      cacheListener?.(change);
    },
  };

  const source = createBookmarkSource({
    platform: platform as unknown as BookmarkPlatformPort,
    cache: cache as unknown as BookmarkCache,
    initial: {
      enabled: false,
      mode: 'region',
      hiddenRules: [],
      ...options.initial,
    },
    now: options.now ?? (() => 1000),
    coalesceMs: 10,
    setTimer: (operation) => {
      timerId += 1;
      timers.set(timerId, operation);
      return timerId;
    },
    clearTimer: (timer) => { timers.delete(timer as number); },
  });

  return {
    source,
    platform,
    cache,
    timers: {
      pending: () => timers.size,
      flush() {
        const operations = [...timers.values()];
        timers.clear();
        for (const operation of operations) operation();
      },
    },
  };
}

async function flush(): Promise<void> {
  // 让已排队的微任务与 promise 链全部落地。
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

describe('未启用 / 能力缺失', () => {
  it('默认关闭：不读权限、不读书签、不留空投影，并清掉遗留缓存', async () => {
    const test = harness({ cached: { version: 1, tree: normalizedTree(), readAt: 5 } });

    await test.source.initialize();

    expect(test.source.getSnapshot().status).toBe('disabled');
    expect(test.source.getSnapshot().projection).toBeNull();
    expect(test.platform.permission).not.toHaveBeenCalled();
    expect(test.platform.read).not.toHaveBeenCalled();
    expect(test.cache.clear).toHaveBeenCalled();
    expect(test.cache.stored()).toBeNull();
  });

  it('权限接口不可用时是 unsupported，不是 error', async () => {
    const test = harness({ initial: { enabled: true } });
    test.platform.permission.mockRejectedValue(new Error('permissions unavailable'));

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.projection).toBeNull();
    expect(snapshot.error).toContain('permissions unavailable');
  });

  it('已授权但命名空间缺失时是 unsupported，且不读树', async () => {
    const test = harness({ initial: { enabled: true }, capability: 'unsupported' });

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.permission).toBe('granted');
    expect(test.platform.read).not.toHaveBeenCalled();
  });

  it('未授权时是 permission-missing，不读树、不展示缓存', async () => {
    const test = harness({
      initial: { enabled: true },
      permission: 'denied',
      cached: { version: 1, tree: normalizedTree(), readAt: 5 },
    });

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('permission-missing');
    expect(snapshot.projection).toBeNull();
    expect(snapshot.readAt).toBeNull();
    expect(test.platform.read).not.toHaveBeenCalled();
    expect(test.cache.read).not.toHaveBeenCalled();
    expect(test.cache.stored()).toBeNull();
  });
});

describe('fresh-first 与 ready', () => {
  it('首屏读取成功：ready，投影来自实时树，读取后再写缓存', async () => {
    const test = harness({ initial: { enabled: true } });

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.stale).toBe(false);
    expect(snapshot.readAt).toBe(1000);
    expect(snapshot.projection?.mode).toBe('region');
    expect(snapshot.projection?.nodeCount).toBe(2);
    // 首屏不从缓存起步：只有在实时读取成功后才允许读/写缓存。
    expect(test.cache.read).not.toHaveBeenCalled();
    expect(test.cache.write).toHaveBeenCalledTimes(1);
  });

  it('读取期间是 loading，且此时不会先展示缓存内容', async () => {
    const pending = deferred<readonly RawBookmarkNode[]>();
    const test = harness({
      initial: { enabled: true },
      cached: { version: 1, tree: normalizedTree(), readAt: 5 },
    });
    test.platform.read.mockReturnValue(pending.promise);

    const running = test.source.initialize();
    await flush();
    expect(test.source.getSnapshot().status).toBe('loading');
    expect(test.source.getSnapshot().projection).toBeNull();

    pending.resolve(rawTree());
    await running;
    expect(test.source.getSnapshot().status).toBe('ready');
  });

  it('刷新失败但权限有效且有缓存时进入 stale，并使用缓存读取时间', async () => {
    const cachedTree = normalizedTree();
    const test = harness({
      initial: { enabled: true },
      cached: { version: 1, tree: cachedTree, readAt: 321 },
    });
    test.platform.read.mockRejectedValueOnce(new Error('read failed'));

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('stale');
    expect(snapshot.stale).toBe(true);
    expect(snapshot.readAt).toBe(321);
    expect(snapshot.error).toContain('read failed');
    expect(snapshot.projection?.nodeCount).toBe(2);
  });

  it('刷新失败、权限有效但无缓存时是 error，绝不显示空态为“没有书签”', async () => {
    const test = harness({ initial: { enabled: true } });
    test.platform.read.mockRejectedValue(new Error('boom'));

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.projection).toBeNull();
    expect(snapshot.error).toContain('boom');
  });

  it('结构非法时整次失败并进入 error，不发布部分树', async () => {
    const test = harness({ initial: { enabled: true } });
    test.platform.read.mockResolvedValue([]);

    await test.source.initialize();

    expect(test.source.getSnapshot().status).toBe('error');
    expect(test.source.getSnapshot().projection).toBeNull();
    expect(test.cache.write).not.toHaveBeenCalled();
  });

  it('缓存读取失败时明确报错，不回退到空态', async () => {
    const test = harness({ initial: { enabled: true } });
    test.platform.read.mockRejectedValue(new Error('read failed'));
    test.cache.read.mockRejectedValue(new Error('cache broken'));

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).toContain('cache broken');
  });

  it('缓存写入失败只给可见警告，保留可用投影', async () => {
    const test = harness({ initial: { enabled: true } });
    test.cache.write.mockRejectedValue(new Error('quota'));

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.projection).not.toBeNull();
    expect(snapshot.cacheWarning).toContain('quota');
  });

  it('缓存写入被取代（write 返回 false）时给出可见警告', async () => {
    const test = harness({ initial: { enabled: true } });
    test.cache.write.mockResolvedValue(false);

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.cacheWarning).toContain('未保存');
  });

  it('读取途中的普通错误在权限仍有效时是 stale，而不是 unsupported', async () => {
    const test = harness({
      initial: { enabled: true },
      cached: { version: 1, tree: normalizedTree(), readAt: 1 },
    });
    test.platform.read.mockRejectedValue(new Error('bookmarks api gone'));
    test.platform.permission.mockResolvedValue('granted');

    await test.source.initialize();
    // 普通错误仍走 stale；只有平台层结构化 unsupported 才整体降级。
    expect(test.source.getSnapshot().status).toBe('stale');
  });

  it('读取途中命名空间消失（结构化 unsupported）时不降级到缓存', async () => {
    const test = harness({
      initial: { enabled: true },
      cached: { version: 1, tree: normalizedTree(), readAt: 1 },
    });
    const gone = Object.assign(new Error('bookmarks api gone'), { code: 'unsupported' });
    test.platform.read.mockRejectedValue(gone);

    await test.source.initialize();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('unsupported');
    expect(snapshot.projection).toBeNull();
    expect(test.cache.read).not.toHaveBeenCalled();
  });
});

describe('权限事件与订阅', () => {
  it('权限事件启动即订阅，且不依赖 bookmarks 命名空间存在', async () => {
    const test = harness({ capability: 'unsupported' });

    await test.source.initialize();

    expect(test.platform.subscribePermissionChanges).toHaveBeenCalledTimes(1);
    // 命名空间缺失时不应尝试绑定书签事件。
    expect(test.platform.subscribeChanges).not.toHaveBeenCalled();
  });

  it('授权后绑定当时可用的书签事件并刷新', async () => {
    const test = harness({ initial: { enabled: true }, capability: 'unsupported', permission: 'denied' });
    await test.source.initialize();
    expect(test.platform.subscribeChanges).not.toHaveBeenCalled();

    // 模拟授权后命名空间出现。
    test.platform.capability.mockReturnValue('available');
    test.platform.permission.mockResolvedValue('granted');
    test.source.getSnapshot();

    test.platform.emitPermission({ added: true, bookmarks: true });
    await flush();

    expect(test.platform.subscribeChanges).toHaveBeenCalledTimes(1);
    expect(test.platform.read).toHaveBeenCalledTimes(1);
    expect(test.source.getSnapshot().status).toBe('ready');
  });

  it('明确撤销时同步清空投影，不等 contains；随后复核并清缓存', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();
    expect(test.source.getSnapshot().status).toBe('ready');

    const contains = deferred<BookmarkPermission>();
    test.platform.permission.mockReturnValue(contains.promise);

    test.platform.emitPermission({ added: false, bookmarks: true });

    // 同步可见：尚未 await 任何东西，投影必须已经消失。
    const immediate = test.source.getSnapshot();
    expect(immediate.status).toBe('permission-missing');
    expect(immediate.projection).toBeNull();
    expect(immediate.readAt).toBeNull();
    expect(immediate.pendingRules).toEqual([]);

    contains.resolve('denied');
    await flush();

    expect(test.source.getSnapshot().status).toBe('permission-missing');
    expect(test.cache.clear).toHaveBeenCalled();
    expect(test.cache.stored()).toBeNull();
  });

  it('载荷无法判定时用 contains 复核，撤销结果仍然清理并清缓存', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();

    test.platform.permission.mockResolvedValue('denied');
    test.platform.emitPermission({ added: false, bookmarks: null });
    await flush();

    expect(test.source.getSnapshot().status).toBe('permission-missing');
    expect(test.cache.clear).toHaveBeenCalled();
  });

  it('与书签无关的权限事件不影响已就绪状态', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();

    test.platform.emitPermission({ added: true, bookmarks: false });
    test.platform.emitPermission({ added: false, bookmarks: false });
    await flush();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(test.cache.clear).not.toHaveBeenCalled();
  });

  it('权限复核抛错时清理内存与缓存，并显示原因', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();
    test.cache.clear.mockClear();

    test.platform.permission.mockRejectedValue(new Error('permissions broken'));
    test.platform.emitPermission({ added: true, bookmarks: null });
    await flush();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('permission-missing');
    expect(snapshot.projection).toBeNull();
    expect(snapshot.error).toContain('permissions broken');
    expect(test.cache.clear).toHaveBeenCalled();
  });
});

describe('变更事件与导入会话', () => {
  it('变更事件经合并窗口只重读一次', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();
    test.platform.read.mockClear();

    const handlers = test.platform.changeHandlers();
    handlers?.changed();
    handlers?.changed();
    handlers?.changed();
    expect(test.platform.read).not.toHaveBeenCalled();

    test.timers.flush();
    await flush();

    expect(test.platform.read).toHaveBeenCalledTimes(1);
    expect(test.source.getSnapshot().status).toBe('ready');
  });

  it('缺少导入事件时导入相关信号不会阻塞刷新', async () => {
    const test = harness({ initial: { enabled: true }, importEvents: false });
    await test.source.initialize();
    test.platform.read.mockClear();

    const handlers = test.platform.changeHandlers();
    handlers?.importingChanged(true);
    // 平台层不会在缺少成对事件时通知 importingChanged；即便通知，也不应长期抑制刷新。
    expect(test.source.getSnapshot().importing).toBe(false);

    handlers?.changed();
    test.timers.flush();
    await flush();
    expect(test.platform.read).toHaveBeenCalledTimes(1);
  });

  it('成对导入事件时进入 importing，结束后刷新一次', async () => {
    const test = harness({ initial: { enabled: true }, importEvents: true });
    await test.source.initialize();
    test.platform.read.mockClear();

    const handlers = test.platform.changeHandlers();
    handlers?.importingChanged(true);
    expect(test.source.getSnapshot().importing).toBe(true);

    handlers?.changed();
    test.timers.flush();
    await flush();
    expect(test.platform.read).not.toHaveBeenCalled();

    handlers?.importingChanged(false);
    test.timers.flush();
    await flush();
    expect(test.platform.read).toHaveBeenCalledTimes(1);
    expect(test.source.getSnapshot().importing).toBe(false);
  });

  it('关闭功能后变更事件不再触发读取', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();
    const handlers = test.platform.changeHandlers();
    await test.source.disable();
    test.platform.read.mockClear();

    handlers?.changed();
    test.timers.flush();
    await flush();

    expect(test.platform.read).not.toHaveBeenCalled();
    expect(test.platform.disposeChanges).toBeTypeOf('function');
  });
});

describe('启用手势与竞态', () => {
  it('请求权限先于任何 await 发出', async () => {
    const test = harness({ capability: 'unsupported', permission: 'denied' });
    const request = deferred<BookmarkPermission>();
    const order: string[] = [];
    test.platform.requestPermission.mockImplementation(() => { order.push('request'); return request.promise; });
    test.platform.permission.mockImplementation(async () => { order.push('contains'); return 'granted'; });

    const running = test.source.enableFromGesture();
    // 不 await：请求必须已在调用栈内同步发出。
    expect(order).toEqual(['request']);

    test.platform.capability.mockReturnValue('available');
    request.resolve('granted');
    await running;
    expect(order[0]).toBe('request');
    expect(order).toContain('contains');
  });

  it('启用成功后绑定事件并进入 ready', async () => {
    const test = harness({ capability: 'unsupported', permission: 'denied' });
    const request = deferred<BookmarkPermission>();
    test.platform.requestPermission.mockReturnValue(request.promise);

    const running = test.source.enableFromGesture();
    test.platform.capability.mockReturnValue('available');
    test.platform.permission.mockResolvedValue('granted');
    request.resolve('granted');
    await expect(running).resolves.toBe('granted');
    await flush();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.status).toBe('ready');
    expect(test.platform.subscribeChanges).toHaveBeenCalledTimes(1);
  });

  it('拒绝授权保持关闭，且不读树、不写缓存', async () => {
    const test = harness({ permission: 'denied' });
    test.platform.requestPermission.mockResolvedValue('denied');

    await expect(test.source.enableFromGesture()).resolves.toBe('denied');

    const snapshot = test.source.getSnapshot();
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.projection).toBeNull();
    expect(test.platform.read).not.toHaveBeenCalled();
    expect(test.cache.write).not.toHaveBeenCalled();
  });

  it('在途授权请求被关闭功能作废：旧请求返回后功能不得重新启用', async () => {
    const test = harness({ permission: 'denied' });
    const request = deferred<BookmarkPermission>();
    test.platform.requestPermission.mockReturnValue(request.promise);

    const running = test.source.enableFromGesture();
    await test.source.disable();

    test.platform.permission.mockResolvedValue('granted');
    request.resolve('granted');
    await running;
    await flush();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.projection).toBeNull();
    expect(test.platform.read).not.toHaveBeenCalled();
  });

  it('在途授权请求被明确撤销作废：旧请求返回 granted 时不得重新启用', async () => {
    const test = harness({ initial: { enabled: false }, permission: 'denied' });
    const request = deferred<BookmarkPermission>();
    test.platform.requestPermission.mockReturnValue(request.promise);

    const running = test.source.enableFromGesture();
    // 用户在请求尚未返回时撤销了权限。
    test.platform.emitPermission({ added: false, bookmarks: true });
    await flush();

    test.platform.permission.mockResolvedValue('granted');
    request.resolve('granted');
    await expect(running).resolves.toBe('granted');
    await flush();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.status).not.toBe('ready');
    expect(snapshot.projection).toBeNull();
    expect(test.platform.read).not.toHaveBeenCalled();
  });

  it('关闭意图（偏好 enabled=false，快照仍 disabled）作废在途授权请求', async () => {
    const test = harness({ permission: 'denied' });
    const request = deferred<BookmarkPermission>();
    test.platform.requestPermission.mockReturnValue(request.promise);

    const running = test.source.enableFromGesture();
    await test.source.applyPreferences({ enabled: false, mode: 'region', hiddenRules: [] });

    test.platform.permission.mockResolvedValue('granted');
    request.resolve('granted');
    await expect(running).resolves.toBe('granted');
    await flush();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.projection).toBeNull();
    expect(test.platform.read).not.toHaveBeenCalled();
  });

  it('撤销之后真正的独立授权事件仍能恢复', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();

    // 真实撤销：contains 也应随之返回 denied。
    test.platform.setPermission('denied');
    test.platform.emitPermission({ added: false, bookmarks: true });
    await flush();
    expect(test.source.getSnapshot().status).toBe('permission-missing');

    // 用户重新授权：这是一次新的独立事件，必须恢复。
    test.platform.setPermission('granted');
    test.platform.emitPermission({ added: true, bookmarks: true });
    await flush();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.permission).toBe('granted');
    expect(snapshot.status).toBe('ready');
    expect(snapshot.projection).not.toBeNull();
  });

  it('销毁后迟到的授权结果不写快照，也不读书签', async () => {
    const test = harness({ permission: 'denied' });
    const request = deferred<BookmarkPermission>();
    test.platform.requestPermission.mockReturnValue(request.promise);

    const running = test.source.enableFromGesture();
    test.source.dispose();
    const snapshotAtDispose = test.source.getSnapshot();

    test.platform.permission.mockResolvedValue('granted');
    request.resolve('granted');
    await running;
    await flush();

    expect(test.source.getSnapshot()).toBe(snapshotAtDispose);
    expect(test.platform.read).not.toHaveBeenCalled();
  });

  it('销毁后迟到的读取结果不会发布', async () => {
    const pending = deferred<readonly RawBookmarkNode[]>();
    const test = harness({ initial: { enabled: true } });
    test.platform.read.mockReturnValue(pending.promise);

    const running = test.source.initialize();
    await flush();
    test.source.dispose();

    pending.resolve(rawTree());
    await running;
    await flush();

    expect(test.source.getSnapshot().status).toBe('loading');
    expect(test.source.getSnapshot().projection).toBeNull();
    expect(test.cache.write).not.toHaveBeenCalled();
  });

  it('关闭功能立即清空内存与缓存', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();
    expect(test.cache.stored()).not.toBeNull();

    await test.source.disable();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.projection).toBeNull();
    expect(snapshot.readAt).toBeNull();
    expect(test.cache.stored()).toBeNull();
  });

  it('关闭期间在途读取完成后也不得把投影带回来', async () => {
    const pending = deferred<readonly RawBookmarkNode[]>();
    const test = harness({ initial: { enabled: true } });
    test.platform.read.mockReturnValue(pending.promise);

    const running = test.source.initialize();
    await flush();
    await test.source.disable();

    pending.resolve(rawTree());
    await running;
    await flush();

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.projection).toBeNull();
    expect(test.cache.write).not.toHaveBeenCalled();
  });
});

describe('偏好应用', () => {
  it('模式变化只重新投影，不重新读取浏览器', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();
    test.platform.read.mockClear();

    await test.source.applyPreferences({ enabled: true, mode: 'folder', hiddenRules: [] });

    expect(test.platform.read).not.toHaveBeenCalled();
    expect(test.source.getSnapshot().mode).toBe('folder');
    expect(test.source.getSnapshot().projection?.mode).toBe('folder');
  });

  it('隐藏规则变化在当前树重新解析，pending 只留在内存', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();

    await test.source.applyPreferences({
      enabled: true,
      mode: 'region',
      hiddenRules: [{
        ruleId: 'r1',
        targetId: 'missing',
        path: ['书签栏', '不存在'],
        kind: 'folder',
        hidden: true,
        updatedAt: 1,
      }],
    });

    const snapshot = test.source.getSnapshot();
    expect(snapshot.pendingRules.map((entry) => entry.status)).toEqual(['unmatched']);
    expect(snapshot.projection?.nodeCount).toBe(2);
  });

  it('偏好关闭时清空投影与缓存', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();

    await test.source.applyPreferences({ enabled: false, mode: 'region', hiddenRules: [] });

    expect(test.source.getSnapshot().status).toBe('disabled');
    expect(test.source.getSnapshot().projection).toBeNull();
    expect(test.cache.stored()).toBeNull();
  });

  it('偏好关闭时缓存清除失败可见，不伪报成功', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();
    test.cache.clear.mockRejectedValue(new Error('quota exceeded'));

    await test.source.applyPreferences({ enabled: false, mode: 'region', hiddenRules: [] });

    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('disabled');
    expect(snapshot.projection).toBeNull();
    // 失败经 cacheWarning 上抛，由界面快照并入 error 展示。
    expect(snapshot.cacheWarning).toContain('书签缓存清除失败');
    expect(snapshot.cacheWarning).toContain('quota exceeded');
  });
});

describe('缓存变更订阅', () => {
  it('其他上下文清空缓存时，stale 投影不继续展示', async () => {
    const test = harness({
      initial: { enabled: true },
      cached: { version: 1, tree: normalizedTree(), readAt: 77 },
    });
    test.platform.read.mockRejectedValue(new Error('read failed'));
    await test.source.initialize();
    expect(test.source.getSnapshot().status).toBe('stale');

    test.cache.emitChange({ removed: true, value: null });
    const snapshot = test.source.getSnapshot();
    expect(snapshot.status).toBe('error');
    expect(snapshot.projection).toBeNull();
  });

  it('自身写入触发的变更不会把 ready 降级', async () => {
    const test = harness({ initial: { enabled: true }, now: () => 55 });
    await test.source.initialize();
    expect(test.source.getSnapshot().status).toBe('ready');

    test.cache.emitChange({ removed: false, value: { version: 1, tree: normalizedTree(), readAt: 55 } });
    expect(test.source.getSnapshot().status).toBe('ready');
  });

  it('ready 状态下的无关清空事件不改变投影', async () => {
    const test = harness({ initial: { enabled: true } });
    await test.source.initialize();

    test.cache.emitChange({ removed: true, value: null });
    expect(test.source.getSnapshot().status).toBe('ready');
    expect(test.source.getSnapshot().projection).not.toBeNull();
  });
});

describe('open 委托', () => {
  it('原始地址原样交给平台端口，失败上抛', async () => {
    const test = harness();
    await test.source.open('javascript:alert(1)', 'current-tab');
    expect(test.platform.open).toHaveBeenCalledWith('javascript:alert(1)', 'current-tab');

    const failure = new Error('browser rejected');
    test.platform.open.mockRejectedValue(failure);
    await expect(test.source.open('https://a.example/')).rejects.toBe(failure);
  });
});

describe('dispose', () => {
  it('解除所有订阅并停止通知监听者', async () => {
    const test = harness({ initial: { enabled: true } });
    const listener = vi.fn();
    test.source.subscribe(listener);
    await test.source.initialize();
    listener.mockClear();

    test.source.dispose();

    expect(test.platform.changeHandlers()).toBeNull();
    test.platform.emitPermission({ added: true, bookmarks: true });
    test.cache.emitChange({ removed: true, value: null });
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('双实例共享 storage.local：已收到跨页关闭的实例清掉自己的迟到写入', () => {
  interface SharedStorage {
    readonly data: Map<string, unknown>;
    readonly calls: { set: number; remove: number };
    readonly area: BookmarkCacheArea;
    blockNextSet(): void;
    releaseSet(): void;
  }

  function sharedStorage(): SharedStorage {
    const data = new Map<string, unknown>();
    const calls = { set: 0, remove: 0 };
    let gate: (() => void) | null = null;
    let blocking = false;
    const area: BookmarkCacheArea = {
      async get(key) {
        return data.has(key) ? { [key]: data.get(key) } : {};
      },
      async set(items) {
        calls.set += 1;
        if (blocking) {
          blocking = false;
          await new Promise<void>((resolve) => { gate = resolve; });
        }
        for (const [key, value] of Object.entries(items)) data.set(key, value);
      },
      async remove(key) {
        calls.remove += 1;
        data.delete(key);
      },
    };
    return {
      data,
      calls,
      area,
      blockNextSet() { blocking = true; },
      releaseSet() { gate?.(); gate = null; },
    };
  }

  function platform(): BookmarkPlatformPort {
    return {
      capability: () => 'available',
      permission: async () => 'granted',
      requestPermission: async () => 'granted',
      read: async () => rawTree(),
      subscribeChanges: () => ({ importEvents: false, dispose: () => {} }),
      subscribePermissionChanges: () => () => {},
      open: async () => {},
    };
  }

  it('A 的 set 阻塞期间 B 关闭提交，A 收到关闭后释放 set，最终键不存在且不重复清理', async () => {
    const storage = sharedStorage();
    // 两个页面各有自己的缓存实例，但共用同一份 storage.local。
    const cacheA = createBookmarkCache({ area: storage.area, isExtension: () => true });
    const cacheB = createBookmarkCache({ area: storage.area, isExtension: () => true });
    const sourceA = createBookmarkSource({
      platform: platform(), cache: cacheA, initial: { enabled: true, mode: 'region', hiddenRules: [] },
      coalesceMs: 0, now: () => 10,
    });
    const sourceB = createBookmarkSource({
      platform: platform(), cache: cacheB, initial: { enabled: true, mode: 'region', hiddenRules: [] },
      coalesceMs: 0, now: () => 20,
    });
    const gate = createBookmarkPreferenceGate({
      enabled: true, mode: 'region', showInSearch: true, hiddenRules: [],
    });
    const applyPreferences = vi.fn((preferences: BookmarkSourcePreferences) =>
      sourceA.applyPreferences(preferences));
    const deliver = (enabled: boolean) => reconcileBookmarkPreferences({
      gate,
      next: { enabled, mode: 'region', showInSearch: true, hiddenRules: [] },
      origin: 'observer',
      applySource: (preferences) => applyPreferences({
        enabled: preferences.enabled, mode: preferences.mode, hiddenRules: [],
      }),
      interruptEnable: () => {},
      onError: () => {},
    });

    try {
      // 首发是 A 页的当前快照，只建立基线。
      deliver(true);
      expect(applyPreferences).not.toHaveBeenCalled();

      // B 页先成功读取一次，键确实存在于共享 storage.local。
      await sourceB.initialize();
      expect(storage.data.has(BOOKMARK_CACHE_KEY)).toBe(true);
      const writesBeforeA = storage.calls.set;

      // A 读取成功并进入缓存写入；set 被阻塞在“已进入 storage.set”的状态。
      storage.blockNextSet();
      const initializing = sourceA.initialize();
      await flush();
      expect(storage.calls.set).toBe(writesBeforeA + 1);
      // 键此刻仍存在（A 的 set 尚未提交，值是 B 上一次写入的）。
      expect(storage.data.has(BOOKMARK_CACHE_KEY)).toBe(true);

      // B 页关闭：它自己的缓存实例清掉键。此时 A 的 set 还没有提交。
      const disabling = sourceB.disable();
      await disabling;
      expect(storage.data.has(BOOKMARK_CACHE_KEY)).toBe(false);

      // 释放 A 的 set：迟到写入把键写回来（这就是要修的缺口）。
      storage.releaseSet();
      await initializing;
      expect(storage.data.has(BOOKMARK_CACHE_KEY)).toBe(true);

      // A 收到已提交的 false 偏好：走 A 自己已有的 applyPreferences(false) → 本实例 clear。
      const applying = deliver(false);
      expect(applyPreferences).toHaveBeenCalledTimes(1);
      await applying;
      await flush();

      // 清空排在 A 自己的在途 set 之后，因此最终键不存在。
      expect(storage.data.has(BOOKMARK_CACHE_KEY)).toBe(false);
      const snapshotA = sourceA.getSnapshot();
      expect(snapshotA.status).toBe('disabled');
      expect(snapshotA.enabled).toBe(false);
      // 搜索索引只由投影派生：投影为 null 时不产生书签结果。
      expect(snapshotA.projection).toBeNull();

      // 重复投递同一关闭值不再触发额外写入或清理。
      const removesAfterFirstClose = storage.calls.remove;
      const setsAfterFirstClose = storage.calls.set;
      deliver(false);
      await flush();
      expect(applyPreferences).toHaveBeenCalledTimes(1);
      expect(storage.calls.remove).toBe(removesAfterFirstClose);
      expect(storage.calls.set).toBe(setsAfterFirstClose);
    } finally {
      sourceA.dispose();
      sourceB.dispose();
    }
  });
});
