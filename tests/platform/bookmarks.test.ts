import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => {
  const target: Record<string, unknown> = {};
  const browser = new Proxy(target, {
    get: (source, property) => source[property as string],
    has: (source, property) => property in source,
  });
  return { target, browser };
});

vi.mock('wxt/browser', () => ({ browser: runtime.browser }));

import * as bookmarkPlatform from '@/platform/bookmarks';
import { BookmarkUnsupportedError } from '@/platform/bookmarks';

interface BookmarkEventMock {
  readonly listeners: Set<() => void>;
  readonly addListener: ReturnType<typeof vi.fn>;
  readonly removeListener: ReturnType<typeof vi.fn>;
  readonly emit: () => void;
}

function bookmarkEvent(): BookmarkEventMock {
  const listeners = new Set<() => void>();
  return {
    listeners,
    addListener: vi.fn((listener: () => void) => { listeners.add(listener); }),
    removeListener: vi.fn((listener: () => void) => { listeners.delete(listener); }),
    emit: () => { for (const listener of [...listeners]) listener(); },
  };
}

interface PermissionEventMock {
  readonly listeners: Set<(permissions: { readonly permissions?: readonly string[] }) => void>;
  readonly addListener: ReturnType<typeof vi.fn>;
  readonly removeListener: ReturnType<typeof vi.fn>;
  readonly emit: (permissions?: { readonly permissions?: readonly string[] }) => void;
}

function permissionEvent(): PermissionEventMock {
  const listeners = new Set<(permissions: { readonly permissions?: readonly string[] }) => void>();
  return {
    listeners,
    addListener: vi.fn((listener: (permissions: { readonly permissions?: readonly string[] }) => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: (permissions: { readonly permissions?: readonly string[] }) => void) => {
      listeners.delete(listener);
    }),
    emit: (permissions) => { for (const listener of [...listeners]) listener(permissions as never); },
  };
}

function setRuntime(value: Record<string, unknown>): void {
  for (const key of Object.keys(runtime.target)) delete runtime.target[key];
  Object.assign(runtime.target, value);
}

beforeEach(() => {
  for (const key of Object.keys(runtime.target)) delete runtime.target[key];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('只读导出边界', () => {
  it('不导出任何书签写入方法', () => {
    const forbidden = ['create', 'update', 'move', 'remove', 'removeTree', 'search'];
    for (const name of forbidden) {
      expect(name in bookmarkPlatform).toBe(false);
    }
    expect(Object.keys(bookmarkPlatform).sort()).toEqual([
      'BookmarkUnsupportedError',
      'getBookmarkManagerGuidance',
      'hasBookmarkApi',
      'hasBookmarkPermission',
      'openBookmark',
      'readBookmarkTree',
      'requestBookmarkPermission',
      'subscribeBookmarkChanges',
      'subscribeBookmarkPermissionChanges',
    ]);
  });
});

describe('能力与权限探测', () => {
  it('普通网页预览报告 unsupported 而不是抛错', () => {
    expect(bookmarkPlatform.hasBookmarkApi()).toBe('unsupported');
  });

  it('只有 getTree 可调用时才报告 available', () => {
    setRuntime({ bookmarks: { getTree: vi.fn() } });
    expect(bookmarkPlatform.hasBookmarkApi()).toBe('available');
    setRuntime({ bookmarks: { create: vi.fn() } });
    expect(bookmarkPlatform.hasBookmarkApi()).toBe('unsupported');
  });

  it('权限查询只调用 contains，不读取书签内容', async () => {
    const getTree = vi.fn();
    const contains = vi.fn().mockResolvedValue(true);
    setRuntime({ bookmarks: { getTree }, permissions: { request: vi.fn(), contains } });

    await expect(bookmarkPlatform.hasBookmarkPermission()).resolves.toBe('granted');
    expect(contains).toHaveBeenCalledWith({ permissions: ['bookmarks'] });
    expect(getTree).not.toHaveBeenCalled();
  });

  it('权限接口缺失时给出明确 unsupported', async () => {
    await expect(bookmarkPlatform.hasBookmarkPermission()).rejects.toBeInstanceOf(BookmarkUnsupportedError);
    expect(() => bookmarkPlatform.requestBookmarkPermission()).toThrowError(BookmarkUnsupportedError);
  });
});

describe('requestBookmarkPermission', () => {
  it('在 bookmarks 命名空间不可用时仍能同步发起请求', () => {
    const request = vi.fn().mockReturnValue(new Promise(() => {}));
    const contains = vi.fn().mockResolvedValue(false);
    setRuntime({ permissions: { request, contains } });

    let settled = false;
    void bookmarkPlatform.requestBookmarkPermission().then(() => { settled = true; });

    // 请求必须在调用栈内同步发出：授权前 namespace 缺失不能阻止请求。
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ permissions: ['bookmarks'] });
    expect(contains).not.toHaveBeenCalled();
    expect(settled).toBe(false);
  });

  it('请求先于任何 await（未完成时不得先行查询 contains）', async () => {
    const order: string[] = [];
    const request = vi.fn(async () => { order.push('request'); return true; });
    const contains = vi.fn(async () => { order.push('contains'); return true; });
    setRuntime({ permissions: { request, contains } });

    await bookmarkPlatform.requestBookmarkPermission();
    expect(order).toEqual(['request']);
  });

  it('拒绝返回 denied，不抛错', async () => {
    const request = vi.fn().mockResolvedValue(false);
    setRuntime({ permissions: { request, contains: vi.fn() } });
    await expect(bookmarkPlatform.requestBookmarkPermission()).resolves.toBe('denied');
  });
});

describe('readBookmarkTree', () => {
  it('原样返回浏览器树，不在此处规范化', async () => {
    const raw = [{ id: '0', children: [] }];
    setRuntime({ bookmarks: { getTree: vi.fn().mockResolvedValue(raw) } });
    await expect(bookmarkPlatform.readBookmarkTree()).resolves.toBe(raw);
  });

  it('非数组结果明确失败', async () => {
    setRuntime({ bookmarks: { getTree: vi.fn().mockResolvedValue({}) } });
    await expect(bookmarkPlatform.readBookmarkTree()).rejects.toThrowError(/顶层不是数组/);
  });
});

describe('subscribeBookmarkChanges', () => {
  it('只挂载浏览器实际存在的事件；核心四项缺失也不报错', () => {
    const created = bookmarkEvent();
    const changed = bookmarkEvent();
    setRuntime({ bookmarks: { getTree: vi.fn(), onCreated: created, onChanged: changed } });

    const handlers = { changed: vi.fn(), importingChanged: vi.fn() };
    const subscription = bookmarkPlatform.subscribeBookmarkChanges(handlers);

    expect(subscription.importEvents).toBe(false);
    expect(created.listeners.size).toBe(1);
    expect(changed.listeners.size).toBe(1);
    created.emit();
    expect(handlers.changed).toHaveBeenCalledTimes(1);
    subscription.dispose();
    expect(created.listeners.size).toBe(0);
    expect(changed.listeners.size).toBe(0);
  });

  it('只有 onImportBegan 时不启用导入会话，也不挂载单侧监听', () => {
    const began = bookmarkEvent();
    setRuntime({ bookmarks: { getTree: vi.fn(), onImportBegan: began } });

    const handlers = { changed: vi.fn(), importingChanged: vi.fn() };
    const subscription = bookmarkPlatform.subscribeBookmarkChanges(handlers);

    expect(subscription.importEvents).toBe(false);
    expect(began.listeners.size).toBe(0);
  });

  it('只有 onImportEnded 时同样视为不支持导入会话', () => {
    const ended = bookmarkEvent();
    setRuntime({ bookmarks: { getTree: vi.fn(), onImportEnded: ended } });
    expect(bookmarkPlatform.subscribeBookmarkChanges({
      changed: vi.fn(),
      importingChanged: vi.fn(),
    }).importEvents).toBe(false);
    expect(ended.listeners.size).toBe(0);
  });

  it('began/ended 成对存在时才挂载并在 dispose 后全部解绑', () => {
    const began = bookmarkEvent();
    const ended = bookmarkEvent();
    const reordered = bookmarkEvent();
    setRuntime({
      bookmarks: {
        getTree: vi.fn(),
        onImportBegan: began,
        onImportEnded: ended,
        onChildrenReordered: reordered,
      },
    });

    const handlers = { changed: vi.fn(), importingChanged: vi.fn() };
    const subscription = bookmarkPlatform.subscribeBookmarkChanges(handlers);

    expect(subscription.importEvents).toBe(true);
    began.emit();
    expect(handlers.importingChanged).toHaveBeenCalledWith(true);
    ended.emit();
    expect(handlers.importingChanged).toHaveBeenLastCalledWith(false);
    reordered.emit();
    expect(handlers.changed).toHaveBeenCalledTimes(1);

    subscription.dispose();
    expect(began.listeners.size).toBe(0);
    expect(ended.listeners.size).toBe(0);
    expect(reordered.listeners.size).toBe(0);
  });

  it('没有 bookmarks 命名空间时返回可安全 dispose 的空订阅', () => {
    const subscription = bookmarkPlatform.subscribeBookmarkChanges({
      changed: vi.fn(),
      importingChanged: vi.fn(),
    });
    expect(subscription.importEvents).toBe(false);
    expect(() => subscription.dispose()).not.toThrow();
  });
});

describe('subscribeBookmarkPermissionChanges', () => {
  it('bookmarks 命名空间缺失时仍能安装订阅', () => {
    const added = permissionEvent();
    const removed = permissionEvent();
    setRuntime({ permissions: { request: vi.fn(), contains: vi.fn(), onAdded: added, onRemoved: removed } });

    const listener = vi.fn();
    const dispose = bookmarkPlatform.subscribeBookmarkPermissionChanges(listener);
    expect(added.listeners.size).toBe(1);
    expect(removed.listeners.size).toBe(1);
    dispose();
    expect(added.listeners.size).toBe(0);
    expect(removed.listeners.size).toBe(0);
  });

  it('载荷是 Permissions 对象时上报 bookmarks 命中情况', () => {
    const added = permissionEvent();
    const removed = permissionEvent();
    setRuntime({ permissions: { request: vi.fn(), contains: vi.fn(), onAdded: added, onRemoved: removed } });

    const listener = vi.fn();
    bookmarkPlatform.subscribeBookmarkPermissionChanges(listener);

    added.emit({ permissions: ['bookmarks'] });
    expect(listener).toHaveBeenLastCalledWith({ added: true, bookmarks: true });
    removed.emit({ permissions: ['bookmarks'] });
    expect(listener).toHaveBeenLastCalledWith({ added: false, bookmarks: true });
    added.emit({ permissions: ['webRequest'] });
    expect(listener).toHaveBeenLastCalledWith({ added: true, bookmarks: false });
  });

  it('载荷无法判定时上报 null，交由调用方 contains 复核', () => {
    const added = permissionEvent();
    setRuntime({ permissions: { request: vi.fn(), contains: vi.fn(), onAdded: added } });

    const listener = vi.fn();
    bookmarkPlatform.subscribeBookmarkPermissionChanges(listener);
    added.emit(undefined);
    expect(listener).toHaveBeenLastCalledWith({ added: true, bookmarks: null });
    added.emit({});
    expect(listener).toHaveBeenLastCalledWith({ added: true, bookmarks: null });
  });

  it('没有 permissions 接口时返回可安全调用的空订阅', () => {
    const dispose = bookmarkPlatform.subscribeBookmarkPermissionChanges(vi.fn());
    expect(() => dispose()).not.toThrow();
  });
});

describe('openBookmark', () => {
  it('把原始地址原样交给 tabs.create，不做协议过滤或改写', async () => {
    const create = vi.fn().mockResolvedValue({});
    setRuntime({ tabs: { create, query: vi.fn(), update: vi.fn() } });

    await bookmarkPlatform.openBookmark('javascript:alert(1)', 'new-tab');
    expect(create).toHaveBeenCalledWith({ url: 'javascript:alert(1)' });

    await bookmarkPlatform.openBookmark('file:///C:/notes.html');
    expect(create).toHaveBeenLastCalledWith({ url: 'file:///C:/notes.html' });
  });

  it('current-tab 先定位当前标签页再更新，失败原样抛出', async () => {
    const update = vi.fn().mockResolvedValue({});
    const query = vi.fn().mockResolvedValue([{ id: 7 }]);
    setRuntime({ tabs: { create: vi.fn(), query, update } });

    await bookmarkPlatform.openBookmark('chrome://bookmarks', 'current-tab');
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(update).toHaveBeenCalledWith(7, { url: 'chrome://bookmarks' });

    const failure = new Error('browser rejected scheme');
    update.mockRejectedValueOnce(failure);
    await expect(bookmarkPlatform.openBookmark('data:text/html,hi', 'current-tab')).rejects.toBe(failure);
  });

  it('没有当前标签页时明确失败，不创建新标签页', async () => {
    const create = vi.fn();
    const update = vi.fn();
    setRuntime({ tabs: { create, query: vi.fn().mockResolvedValue([]), update } });

    await expect(bookmarkPlatform.openBookmark('https://a.example/', 'current-tab'))
      .rejects.toThrowError(/无法找到当前标签页/);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('缺失或空白地址直接失败，不调用导航 API', async () => {
    const create = vi.fn();
    setRuntime({ tabs: { create, query: vi.fn(), update: vi.fn() } });

    await expect(bookmarkPlatform.openBookmark('   ')).rejects.toThrowError(/地址缺失/);
    expect(create).not.toHaveBeenCalled();
  });

  it('标签页接口缺失时给出明确 unsupported', async () => {
    setRuntime({});
    await expect(bookmarkPlatform.openBookmark('https://a.example/')).rejects.toBeInstanceOf(BookmarkUnsupportedError);
  });
});

describe('管理器指引', () => {
  it('未验证前只给手动指引，不宣称按钮可用', () => {
    const guidance = bookmarkPlatform.getBookmarkManagerGuidance();
    expect(guidance.routeVerified).toBe(false);
    expect(guidance.chrome).toContain('Ctrl+Shift+O');
    expect(guidance.firefox).toContain('Ctrl+Shift+O');
  });
});
