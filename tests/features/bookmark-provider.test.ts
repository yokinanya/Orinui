import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import {
  applyHiddenRules,
  bookmarkOpenFailureMessage,
  bookmarkViewSnapshot,
  bookmarkViewStatus,
  enableAttemptSucceeded,
  openBookmarkWithFeedback,
  resolveBookmarkOpenTarget,
  resolveHiddenRuleIds,
  type BookmarkViewInput,
} from '@/app/BookmarkFeatureProvider';
import { resolveOpenFolder } from '@/app/HomeActions';
import { createBookmarkSource, type BookmarkPlatformPort, type BookmarkSourcePreferences,
  type BookmarkSourceSnapshot } from '@/app/bookmark-source';
import type { BookmarkCache } from '@/platform/bookmark-cache';
import { normalizeBookmarkTree, type RawBookmarkNode } from '@/domain/browser-bookmarks';
import { createDefaultBookmarkPreferences } from '@/domain/bookmark-preferences';
import type { BookmarkViewSnapshot } from '@/features/bookmarks/bookmark-view';

// 装配层的可执行检查：不启动浏览器、不请求权限、不接触真实扩展 API。
// 真实扩展里的权限弹窗、撤销事件与书签打开委托仍需 Chrome / Firefox 各自验收。
vi.mock('wxt/browser', () => ({ browser: {} }));

const TREE_ROOT: RawBookmarkNode = {
  id: 'menu________',
  title: '书签栏',
  type: 'folder',
  children: [
    { id: 'link', parentId: 'menu________', title: '示例', url: 'https://example.com/a b' },
    { id: 'broken', parentId: 'menu________', title: '缺协议', url: 'example.com/x' },
    { id: 'empty', parentId: 'menu________', title: '空地址', url: '   ' },
    {
      id: 'work', parentId: 'menu________', title: '工作', type: 'folder',
      children: [{ id: 'deep', parentId: 'work', title: '子项', url: 'https://deep.example/' }],
    },
  ],
};

const TREE = normalizeBookmarkTree([TREE_ROOT]);

describe('跨页关闭失败可见', () => {
  it('缓存清除失败进入界面快照的 error，由设置面板 FieldError 展示', () => {
    const view = bookmarkViewSnapshot(input({
      source: source({ status: 'disabled', enabled: false, projection: null, readAt: null,
        cacheWarning: '书签缓存清除失败：quota exceeded' }),
      intentEnabled: false,
      tree: null,
    }));
    expect(view.status).toBe('disabled');
    expect(view.error).toBe('书签缓存清除失败：quota exceeded');
    expect(view.roots).toEqual([]);
  });
});

function source(overrides: Partial<BookmarkSourceSnapshot> = {}): BookmarkSourceSnapshot {
  return {
    status: 'ready',
    capability: 'available',
    permission: 'granted',
    enabled: true,
    mode: 'region',
    projection: null,
    readAt: 1_700_000_000_000,
    stale: false,
    error: null,
    importing: false,
    pendingRules: [],
    cacheWarning: null,
    ...overrides,
  };
}

function input(overrides: Partial<BookmarkViewInput> = {}): BookmarkViewInput {
  return {
    source: source(),
    tree: TREE,
    intentEnabled: true,
    preferences: { ...createDefaultBookmarkPreferences(), enabled: true },
    layoutHidden: [],
    actionError: null,
    busy: false,
    folderRequest: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<BookmarkViewSnapshot> = {}): BookmarkViewSnapshot {
  return { ...bookmarkViewSnapshot(input()), ...overrides };
}

describe('状态映射', () => {
  it('启用意图仍在但本机被撤销时归为 permission-missing，而不是关闭', () => {
    expect(bookmarkViewStatus(source({ status: 'disabled', enabled: false, permission: 'denied' }), true))
      .toBe('permission-missing');
    expect(bookmarkViewStatus(source({ status: 'disabled', enabled: false, permission: 'denied' }), false))
      .toBe('disabled');
  });

  it('导入会话进行中保持可读状态 importing，其余状态原样透出', () => {
    expect(bookmarkViewStatus(source({ importing: true }), true)).toBe('importing');
    expect(bookmarkViewStatus(source({ status: 'stale' }), true)).toBe('stale');
    expect(bookmarkViewStatus(source({ status: 'unsupported' }), true)).toBe('unsupported');
  });
});

describe('快照映射', () => {
  it('可读时暴露完整树与被隐藏节点，供设置恢复显示', () => {
    const view = bookmarkViewSnapshot(input({
      preferences: {
        enabled: true, mode: 'region', showInSearch: true,
        hiddenRules: [{ ruleId: 'r1', targetId: 'work', path: ['书签栏', '工作'], kind: 'folder', hidden: true, updatedAt: 5 }],
      },
    }));
    expect(view.status).toBe('ready');
    expect(view.roots.map((root) => root.nodeId)).toEqual(['menu________']);
    expect(view.hiddenNodeIds).toEqual(['work']);
    expect(view.ruleMatches).toEqual([{
      ruleId: 'r1', status: 'matched', nodeId: 'work',
      candidates: [{ nodeId: 'work', path: ['书签栏', '工作'], kind: 'folder' }],
    }]);
  });

  it('关闭/撤销/不可用时不给任何根节点，不伪装成空收藏夹', () => {
    for (const [status, permission] of [['disabled', 'unknown'], ['permission-missing', 'denied'],
      ['unsupported', 'unknown'], ['error', 'granted']] as const) {
      const view = bookmarkViewSnapshot(input({
        source: source({ status, permission, enabled: false }),
        intentEnabled: status !== 'disabled',
      }));
      expect(view.roots).toEqual([]);
      expect(view.hiddenNodeIds).toEqual([]);
    }
  });

  it('布局隐藏项取当前值：空数组就是没有隐藏，不回落到旧布局', () => {
    expect(bookmarkViewSnapshot(input({ layoutHidden: [] })).regionVisible).toBe(true);
    expect(bookmarkViewSnapshot(input({ layoutHidden: ['bookmarks'] })).regionVisible).toBe(false);
  });

  it('读取错误与缓存警告都可见，不静默吞掉', () => {
    const view = bookmarkViewSnapshot(input({
      source: source({ error: '读取失败', cacheWarning: '缓存未保存' }),
    }));
    expect(view.error).toBe('读取失败；缓存未保存');
  });
});

describe('打开委托', () => {
  it('可用书签返回浏览器原始地址，不 trim、不改写', () => {
    const resolved = resolveBookmarkOpenTarget(snapshot(), 'link');
    expect(resolved).toEqual({ url: 'https://example.com/a b' });
  });

  it('缺协议或空地址明确失败，不补 scheme', () => {
    expect(resolveBookmarkOpenTarget(snapshot(), 'broken')).toEqual({ error: '书签地址缺失或不完整，无法打开' });
    expect(resolveBookmarkOpenTarget(snapshot(), 'empty')).toEqual({ error: '书签地址缺失或不完整，无法打开' });
  });

  it('不在当前投影、非书签节点或不可读状态下拒绝打开', () => {
    expect(resolveBookmarkOpenTarget(snapshot(), 'missing')).toEqual({ error: '书签已不在当前列表，请重新读取后再试' });
    expect(resolveBookmarkOpenTarget(snapshot(), 'work')).toEqual({ error: '书签已不在当前列表，请重新读取后再试' });
    const denied = snapshot({ permission: 'denied' });
    expect(resolveBookmarkOpenTarget(denied, 'link')).toEqual({ error: '浏览器收藏夹当前不可读取，无法打开书签' });
    const staleButReadable = snapshot({ status: 'stale' });
    expect(resolveBookmarkOpenTarget(staleButReadable, 'link')).toEqual({ url: 'https://example.com/a b' });
  });
});

describe('启用尝试的持久化守卫', () => {
  function snapshotOf(source: BookmarkSourceSnapshot): BookmarkSourceSnapshot {
    return source;
  }

  it('只有数据源真正进入启用状态时才允许持久化意图', () => {
    expect(enableAttemptSucceeded(snapshotOf(source({ status: 'ready', enabled: true, permission: 'granted' }))))
      .toBe(true);
    expect(enableAttemptSucceeded(snapshotOf(source({ status: 'loading', enabled: true, permission: 'granted' }))))
      .toBe(true);
    // 撤销竞态：source 返回原始 granted，但快照仍是 permission-missing / 未启用。
    expect(enableAttemptSucceeded(snapshotOf(source({ status: 'permission-missing', enabled: true, permission: 'denied' }))))
      .toBe(false);
    expect(enableAttemptSucceeded(snapshotOf(source({ status: 'permission-missing', enabled: true, permission: 'granted' }))))
      .toBe(false);
    expect(enableAttemptSucceeded(snapshotOf(source({ status: 'disabled', enabled: false, permission: 'granted' }))))
      .toBe(false);
    expect(enableAttemptSucceeded(snapshotOf(source({ status: 'error', enabled: true, permission: 'granted' }))))
      .toBe(true);
  });

  it('请求期间撤销权限：granted 返回值不再让 provider 保存 enabled', async () => {
    // 跨层回归：平台 request 在撤销事件之后才 resolve 为 granted，
    // 数据源按生命周期代次拒绝启用，provider 守卫必须据此放弃持久化。
    type PermissionListener = (change: { readonly added: boolean; readonly bookmarks: boolean | null }) => void;
    // 属性赋值不会被控制流窄化成 null，便于在回调外手动触发事件。
    const control: { removedListener: PermissionListener | null; resolveRequest: ((permission: 'granted' | 'denied') => void) | null } = {
      removedListener: null, resolveRequest: null,
    };
    let permission: 'granted' | 'denied' = 'denied';
    const platform: BookmarkPlatformPort = {
      capability: () => 'available',
      permission: async () => permission,
      requestPermission: () => new Promise((resolve) => { control.resolveRequest = resolve; }),
      read: async () => [TREE_ROOT],
      subscribeChanges: () => ({ importEvents: false, dispose: () => {} }),
      subscribePermissionChanges: (listener) => {
        control.removedListener = listener;
        return () => { control.removedListener = null; };
      },
      open: async () => {},
    };
    const cache: BookmarkCache = {
      read: async () => null,
      write: async () => true,
      clear: async () => {},
      subscribe: () => () => {},
      minimumGeneration: () => 0,
    };
    const initial: BookmarkSourcePreferences = { enabled: false, mode: 'region', hiddenRules: [] };
    const bookmarkSource = createBookmarkSource({ platform, cache, initial, coalesceMs: 0 });
    await bookmarkSource.initialize();

    const attempt = bookmarkSource.enableFromGesture();
    // 授权弹窗还开着时权限被撤销：撤销事件推进生命周期代次。
    permission = 'denied';
    control.removedListener?.({ added: false, bookmarks: true });
    // 迟到的授权结果仍为 granted。
    control.resolveRequest?.('granted');
    const returned = await attempt;

    expect(returned).toBe('granted');
    const after = bookmarkSource.getSnapshot();
    expect(after.enabled).toBe(false);
    expect(enableAttemptSucceeded(after)).toBe(false);
    expect(after.projection).toBeNull();
    bookmarkSource.dispose();
  });

  it('正常授权后数据源已启用，守卫允许持久化', async () => {
    let permission: 'granted' | 'denied' = 'denied';
    const platform: BookmarkPlatformPort = {
      capability: () => 'available',
      permission: async () => permission,
      requestPermission: async () => { permission = 'granted'; return 'granted'; },
      read: async () => [TREE_ROOT],
      subscribeChanges: () => ({ importEvents: false, dispose: () => {} }),
      subscribePermissionChanges: () => () => {},
      open: async () => {},
    };
    const cache: BookmarkCache = {
      read: async () => null,
      write: async () => true,
      clear: async () => {},
      subscribe: () => () => {},
      minimumGeneration: () => 0,
    };
    const bookmarkSource = createBookmarkSource({
      platform, cache, initial: { enabled: false, mode: 'region', hiddenRules: [] }, coalesceMs: 0,
    });
    await bookmarkSource.initialize();
    expect(await bookmarkSource.enableFromGesture()).toBe('granted');
    expect(enableAttemptSucceeded(bookmarkSource.getSnapshot())).toBe(true);
    bookmarkSource.dispose();
  });
});

describe('App 装配树', () => {
  const app = readFileSync(new URL('../../src/app/App.tsx', import.meta.url), 'utf8');

  it('BookmarkFeatureProvider 位于 DataProvider 内并包住主页内容', () => {
    const data = app.indexOf('<DataProvider>');
    const feature = app.indexOf('<BookmarkFeatureProvider>');
    const motion = app.indexOf('<MotionPlaybackProvider>');
    const home = app.indexOf('<HomeContent />');
    expect(data).toBeGreaterThanOrEqual(0);
    expect(feature).toBeGreaterThan(data);
    expect(motion).toBeGreaterThan(feature);
    expect(home).toBeGreaterThan(motion);
    // 只挂载一次，避免同一页面出现两个数据源。
    expect(app.match(/<BookmarkFeatureProvider>/g)).toHaveLength(1);
  });

  it('主页只在区域非 disabled 时注入 BookmarkRegion，关闭状态不产生空区域', () => {
    expect(app).toContain("bookmarks.snapshot.status !== 'disabled'");
    expect(app).toContain('<BookmarkRegion bookmarks={bookmarks} />');
    expect(app).toContain('bookmarks: bookmarkRegion');
  });

  it('区域整理不依赖快捷方式可见，新增自有内容仍单独受限', () => {
    const actions = readFileSync(new URL('../../src/app/HomeActions.tsx', import.meta.url), 'utf8');
    // 整理入口只受 canEdit 控制，添加菜单只受 canAddContent 控制。
    expect(app).toContain('const canEdit = status === \'ready\' && visibleRegions.length > 0;');
    expect(app).toContain("const canAddContent = status === 'ready' && visibleRegions.includes('shortcuts');");
    expect(app).toContain('canAddContent={canAddContent}');
    expect(actions).toContain('{canAddContent && <HomeAddMenu');
    expect(actions).toContain('{canEdit && (');
    // 快捷方式隐藏时打开的新增表单不会提交不可见内容。
    expect(actions).toContain('open={creating && canAddContent}');
    expect(actions).toContain('open={addingWebsite && canAddContent}');
  });

  it('隐藏书签区域时仍挂载外层文件夹宿主，且宿主在布局渲染之外', () => {
    expect(app).toContain("import { BookmarkFolderHost } from '@/features/bookmarks/BookmarkFolderHost';");
    expect(app).toContain('<BookmarkFolderHost />');
    const layoutCall = app.indexOf('{renderHomeLayout({');
    const host = app.indexOf('<BookmarkFolderHost />');
    expect(host).toBeGreaterThan(layoutCall);
    // 与 HomeActions 同级：位于 HomeContent 的 fragment 内，不在 renderHomeLayout 的参数里。
    expect(app.slice(app.indexOf('function HomeContent'), app.indexOf('export function App'))).toContain('<BookmarkFolderHost />');
    // 区域隐藏只影响区域渲染，不由布局隐藏项取消搜索。
    expect(app).not.toContain('folderRequest: null');
  });
});

describe('书签打开的失败反馈（区域隐藏时仍可见）', () => {
  it('委托成功不报错，且交给平台的是原始地址', async () => {
    const reported: string[] = [];
    const opened: { url: string; target: string }[] = [];
    const ok = await openBookmarkWithFeedback({
      snapshot: snapshot(),
      nodeId: 'link',
      target: 'new-tab',
      open: async (url, target) => { opened.push({ url, target }); },
      report: (message) => reported.push(message),
    });
    expect(ok).toBe(true);
    expect(reported).toEqual([]);
    expect(opened).toEqual([{ url: 'https://example.com/a b', target: 'new-tab' }]);
  });

  it('原生导航拒绝时给出可见中文反馈，且不带书签地址', async () => {
    const reported: string[] = [];
    const ok = await openBookmarkWithFeedback({
      snapshot: snapshot(),
      nodeId: 'link',
      target: 'current-tab',
      // 模拟扩展 tabs API 抛错时错误信息里夹带地址。
      open: async (url) => { throw new Error(`Cannot navigate to ${url} (tabs.update)`); },
      report: (message) => reported.push(message),
    });
    expect(ok).toBe(false);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain('书签未打开');
    expect(reported[0]).not.toContain('https://example.com/a b');
    expect(reported[0]).not.toContain('tabs.update');
  });

  it('不可读状态或节点不在投影时不调用导航，只报明确原因', async () => {
    const reported: string[] = [];
    let opened = 0;
    const denied = snapshot({ permission: 'denied' });
    expect(await openBookmarkWithFeedback({
      snapshot: denied, nodeId: 'link', target: 'new-tab',
      open: async () => { opened += 1; }, report: (message) => reported.push(message),
    })).toBe(false);
    expect(await openBookmarkWithFeedback({
      snapshot: snapshot(), nodeId: 'missing', target: 'new-tab',
      open: async () => { opened += 1; }, report: (message) => reported.push(message),
    })).toBe(false);
    expect(opened).toBe(0);
    expect(reported).toEqual([
      '浏览器收藏夹当前不可读取，无法打开书签',
      '书签已不在当前列表，请重新读取后再试',
    ]);
  });

  it('原生导航失败的任何 cause 都不展示原文，统一固定安全说明', async () => {
    // 含主机名 / 私人标题 / URL 编码值 / javascript 原文 / 普通 error / 非 Error 值，全部不得进入公共反馈。
    const causes: readonly unknown[] = [
      new Error('拒绝访问 secret.example.org 的 私人标题 /private/2026'),
      new Error('failed to open https%3A%2F%2Fsecret.example%2Fprivate%2F2026'),
      new Error('javascript:alert(document.cookie) 被拒绝'),
      new Error('tabs.create failed for 私人书签'),
      new Error(''),
      '已存在同名标签页 secret.example.org/私人路径',
      { message: 'secret.example.org' },
      null,
      undefined,
    ];
    const expected = '书签未打开：浏览器拒绝了打开请求，请稍后重试';
    // 直接断言 helper 不接触 cause/url：签名无参，任何输入都得到同一句固定说明。
    expect(bookmarkOpenFailureMessage()).toBe(expected);
    for (const cause of causes) {
      const reported: string[] = [];
      const ok = await openBookmarkWithFeedback({
        snapshot: snapshot(), nodeId: 'link', target: 'new-tab',
        open: async () => { throw cause; },
        report: (message) => reported.push(message),
      });
      expect(ok).toBe(false);
      // 每次失败恰好上报一次，且是固定说明。
      expect(reported).toEqual([expected]);
      expect(reported[0]).not.toContain('secret');
      expect(reported[0]).not.toContain('私人');
      expect(reported[0]).not.toContain('javascript');
      expect(reported[0]).not.toContain('%2F');
    }
  });

  it('本地固定原因（缺节点 / 坏地址 / 不可读）仍给出明确说明', async () => {
    const reported: string[] = [];
    await openBookmarkWithFeedback({
      snapshot: snapshot(), nodeId: 'broken', target: 'new-tab',
      open: async () => {}, report: (message) => reported.push(message),
    });
    await openBookmarkWithFeedback({
      snapshot: snapshot(), nodeId: 'missing', target: 'new-tab',
      open: async () => {}, report: (message) => reported.push(message),
    });
    await openBookmarkWithFeedback({
      snapshot: snapshot({ permission: 'denied' }), nodeId: 'link', target: 'new-tab',
      open: async () => {}, report: (message) => reported.push(message),
    });
    expect(reported).toEqual([
      '书签地址缺失或不完整，无法打开',
      '书签已不在当前列表，请重新读取后再试',
      '浏览器收藏夹当前不可读取，无法打开书签',
    ]);
  });

  it('成功时原样委托原始地址且只上报零次', async () => {
    const reported: string[] = [];
    const opened: { url: string; target: string }[] = [];
    const ok = await openBookmarkWithFeedback({
      snapshot: snapshot(),
      nodeId: 'link',
      target: 'current-tab',
      open: async (url, target) => { opened.push({ url, target }); },
      report: (message) => reported.push(message),
    });
    expect(ok).toBe(true);
    expect(reported).toEqual([]);
    expect(opened).toEqual([{ url: 'https://example.com/a b', target: 'current-tab' }]);
  });

  it('原生导航失败恰好上报一次安全说明，不回传原始错误文本', async () => {
    const reported: string[] = [];
    const ok = await openBookmarkWithFeedback({
      snapshot: snapshot(),
      nodeId: 'link',
      target: 'new-tab',
      open: async () => { throw new Error('拒绝访问 secret.example.org 的 私人标题 /private/2026'); },
      report: (message) => reported.push(message),
    });
    expect(ok).toBe(false);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toBe('书签未打开：浏览器拒绝了打开请求，请稍后重试');
    expect(reported[0]).not.toContain('secret.example.org');
    expect(reported[0]).not.toContain('私人标题');
    expect(reported[0]).not.toContain('/private/2026');
  });

  it('provider 把打开失败同时送进常驻提示条（区域隐藏时唯一可见通道）', () => {
    const provider = readFileSync(new URL('../../src/app/BookmarkFeatureProvider.tsx', import.meta.url), 'utf8');
    // openBookmark 必须走带反馈的封装，不能只写区域内的 actionError。
    expect(provider).toContain('void openBookmarkWithFeedback({');
    expect(provider).toContain('setActionError(message);');
    expect(provider).toContain('notifyError(new Error(message));');
    // 数据源已销毁时也要有反馈，不静默返回。
    expect(provider).toContain("notifyError(new Error('浏览器收藏夹当前不可用，书签未打开'));");
    // 地址只来自投影解析结果，未再 trim 或补协议。
    expect(provider).not.toContain('node.url.trim');
  });
});

describe('自有文件夹外部删除后的弹层状态', () => {
  const folder = { id: 'f1', name: '工作', parentId: null } as Parameters<typeof resolveOpenFolder>[0][number];

  it('正常存在时直接使用当前数据', () => {
    expect(resolveOpenFolder([folder], 'f1', null)).toEqual({ folder, live: true, unresolved: false });
  });

  it('被外部删除但保留最后真实引用时仍交给弹层显示「已不存在」', () => {
    expect(resolveOpenFolder([], 'f1', folder)).toEqual({ folder, live: false, unresolved: false });
  });

  it('从未解析到的 id 明确归为未解析，不虚构文件夹', () => {
    expect(resolveOpenFolder([], 'gone', null)).toEqual({ folder: null, live: false, unresolved: true });
    // 历史引用指向别的 id 时不能张冠李戴。
    expect(resolveOpenFolder([], 'gone', folder)).toEqual({ folder: null, live: false, unresolved: true });
  });

  it('没有打开请求时不渲染任何弹层', () => {
    expect(resolveOpenFolder([folder], null, folder)).toEqual({ folder: null, live: false, unresolved: false });
  });

  it('HomeActions 用最后引用驱动弹层与关闭清理，不静默卸载', () => {
    const actions = readFileSync(new URL('../../src/app/HomeActions.tsx', import.meta.url), 'utf8');
    expect(actions).toContain('lastKnownFolderRef');
    expect(actions).toContain('const requested = resolveOpenFolder(folders, openFolderId, lastKnownFolderRef.current);');
    expect(actions).toContain('{requested.folder && (');
    expect(actions).toContain('onOpenChange={(next) => { if (!next) closeFolder(); }}');
    expect(actions).toContain('lastKnownFolderRef.current = null;');
    expect(actions).toContain('onOpenFolder(null);');
    expect(actions).toContain('<MissingFolderDialog open={requested.unresolved && status === \'ready\'} onClose={closeFolder} />');
  });
});

describe('同节点多条隐藏规则的批量写入', () => {
  it('只有未传 ruleId 才生成新 ID；有效单串原样保留（不 trim 改名）', () => {
    let generated = 0;
    const makeId = () => `new-${++generated}`;
    expect(resolveHiddenRuleIds(undefined, makeId)).toEqual(['new-1']);
    expect(resolveHiddenRuleIds('r1', makeId)).toEqual(['r1']);
    // 带首尾空白但不是空串：ID 原样保留，不 trim 成别的 ID。
    expect(resolveHiddenRuleIds(' r1 ', makeId)).toEqual([' r1 ']);
    expect(generated).toBe(1);
  });

  it('无效输入整次拒绝，且完全不调用 makeId', () => {
    let generated = 0;
    const makeId = () => `new-${++generated}`;
    expect(() => resolveHiddenRuleIds('   ', makeId)).toThrow('隐藏规则 ID 不能为空');
    expect(() => resolveHiddenRuleIds([], makeId)).toThrow('没有要更新的隐藏规则');
    expect(() => resolveHiddenRuleIds(['r1', '  ', 'r2'], makeId)).toThrow('含空白项');
    expect(() => resolveHiddenRuleIds(['', ' '], makeId)).toThrow('含空白项');
    // 关键：空批量不会静默新建 false 规则。
    expect(generated).toBe(0);
  });

  it('有效数组按调用顺序稳定去重', () => {
    let generated = 0;
    const makeId = () => `new-${++generated}`;
    expect(resolveHiddenRuleIds(['r2', 'r1', 'r2', 'r1', 'r3'], makeId)).toEqual(['r2', 'r1', 'r3']);
    expect(generated).toBe(0);
  });

  it('无效输入不触发任何写入（空批量不会改用户数据）', async () => {
    const written: string[] = [];
    let generated = 0;
    const attempt = async (ruleId: string | readonly string[] | undefined) => {
      const ruleIds = resolveHiddenRuleIds(ruleId, () => `new-${++generated}`);
      return applyHiddenRules({ ruleIds, write: async (id) => { written.push(id); } });
    };
    await expect(attempt([])).rejects.toThrow('没有要更新的隐藏规则');
    await expect(attempt('  ')).rejects.toThrow('隐藏规则 ID 不能为空');
    await expect(attempt(['r1', ' ', 'r2'])).rejects.toThrow('含空白项');
    expect(written).toEqual([]);
    expect(generated).toBe(0);
  });

  it('一次动作内顺序逐条 await 真实写入，第二条不被吞', async () => {
    const written: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const result = await applyHiddenRules({
      ruleIds: ['r1', 'r2'],
      write: async (ruleId) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // 模拟异步存储：每条都必须真正完成后再开始下一条。
        await Promise.resolve();
        inFlight -= 1;
        written.push(ruleId);
      },
    });
    expect(written).toEqual(['r1', 'r2']);
    expect(maxInFlight).toBe(1);
    expect(result).toEqual({ written: ['r1', 'r2'], failedRuleId: null, error: null });
  });

  it('第一条失败即停止，已完成条目如实保留，余条明确可重试', async () => {
    const written: string[] = [];
    const attempted: string[] = [];
    const result = await applyHiddenRules({
      ruleIds: ['r1', 'r2', 'r3'],
      write: async (ruleId) => {
        attempted.push(ruleId);
        if (ruleId === 'r2') throw new Error('本机存储写入失败');
        written.push(ruleId);
      },
    });
    expect(attempted).toEqual(['r1', 'r2']);
    expect(written).toEqual(['r1']);
    expect(result.written).toEqual(['r1']);
    expect(result.failedRuleId).toBe('r2');
    expect(result.error).toContain('已完成 1 条');
    expect(result.error).toContain('还剩 2 条');
    expect(result.error).toContain('本机存储写入失败');
  });

  it('首条就失败时也不伪报成功', async () => {
    const result = await applyHiddenRules({
      ruleIds: ['r1'],
      write: async () => { throw new Error('权限不足'); },
    });
    expect(result.written).toEqual([]);
    expect(result.failedRuleId).toBe('r1');
    expect(result.error).toContain('已完成 0 条');
  });

  it('provider 的 setHidden 用一次 run 驱动该 helper，不循环调用自身', () => {
    const provider = readFileSync(new URL('../../src/app/BookmarkFeatureProvider.tsx', import.meta.url), 'utf8');
    const start = provider.indexOf('const setHidden = useCallback');
    const end = provider.indexOf('const bindRule = useCallback');
    expect(start).toBeGreaterThan(0);
    const body = provider.slice(start, end);
    expect(body).toContain('run(async () => {');
    expect(body).toContain('resolveHiddenRuleIds(ruleId, newId)');
    expect(body).toContain('await applyHiddenRules({');
    // 单次 run：函数体内不出现第二个 run( 调用。
    expect(body.match(/run\(/g)).toHaveLength(1);
    // 不递归调用 setHidden 自身。
    expect(body).not.toContain('setHidden(');
    // 第三参数接受数组类型。
    expect(body).toContain('ruleId?: string | readonly string[]');
  });
});

describe('深层浏览器树的全量视图', () => {
  /** 迭代构造一条 depth 层的合法链：根 → 文件夹… → 末叶链接，并夹杂空 folder 与 separator。 */
  function deepRaw(depth: number): RawBookmarkNode {
    let current: RawBookmarkNode = {
      id: `n${depth}`,
      parentId: `n${depth - 1}`,
      title: `末叶 ${depth}`,
      url: `https://deep.example/${depth}`,
    };
    for (let level = depth - 1; level >= 0; level -= 1) {
      const id = `n${level}`;
      const parentId = level === 0 ? null : `n${level - 1}`;
      current = {
        id,
        ...(parentId === null ? {} : { parentId }),
        title: level === 0 ? '深层根' : `层 ${level}`,
        type: 'folder',
        // 每层额外挂一个空文件夹与分隔符：不能因为深链而丢掉任何节点。
        children: [{ id: `${id}-empty`, parentId: id, title: `空层 ${level}`, type: 'folder' },
          { id: `${id}-sep`, parentId: id, type: 'separator' }, current],
      };
    }
    return current;
  }

  it('depth 5000 的迭代构造树不抛 RangeError，且视图保留全部节点', () => {
    const depth = 5000;
    const tree = normalizeBookmarkTree([deepRaw(depth)]);
    // n0..n{depth} 共 depth+1 个 + 每层空文件夹与分隔符各一个（level 0..depth-1）。
    expect(tree.nodeCount).toBe(depth + 1 + depth * 2);
    const view = bookmarkViewSnapshot({ ...input(), tree });
    expect(view.roots).toHaveLength(1);
    expect(view.roots[0]?.children.map((child) => child.nodeId)).toEqual(['n0-empty', 'n0-sep', 'n1']);

    // 迭代下降整条链：末叶必须可达，路径必须完整（不截断、不丢中间层）。
    let node = view.roots[0]?.children.find((child) => child.nodeId === 'n1');
    expect(node).toBeDefined();
    for (let level = 1; level < depth; level += 1) {
      const next = node?.children.find((child) => child.nodeId === `n${level + 1}`);
      expect(next).toBeDefined();
      node = next;
    }
    expect(node?.nodeId).toBe(`n${depth}`);
    expect(node?.kind).toBe('bookmark');
    expect(node?.title).toBe(`末叶 ${depth}`);
    expect(node?.url).toBe(`https://deep.example/${depth}`);
    expect(node?.path).toHaveLength(depth + 1);
    expect(node?.path[0]).toBe('深层根');
    expect(node?.path[depth]).toBe(`末叶 ${depth}`);
  });

  it('深层视图不丢空文件夹与分隔符，顺序、标题与原始地址保持', () => {
    const tree = normalizeBookmarkTree([deepRaw(1200)]);
    const view = bookmarkViewSnapshot({ ...input(), tree });
    const rootChildren = view.roots[0]?.children ?? [];
    expect(rootChildren.map((child) => child.nodeId)).toEqual(['n0-empty', 'n0-sep', 'n1']);
    expect(rootChildren[0]?.kind).toBe('folder');
    expect(rootChildren[0]?.children).toEqual([]);
    expect(rootChildren[1]?.kind).toBe('separator');
    // 标题与路径原样保留，不做 trim 或协议改写。
    expect(rootChildren[2]?.title).toBe('层 1');
    expect(rootChildren[2]?.path).toEqual(['深层根', '层 1']);
    const last = view.roots[0]?.children[2];
    expect(last?.children.some((child) => child.nodeId === 'n1-empty')).toBe(true);
  });
});

describe('跨页偏好观察接线', () => {
  function providerSource(): string {
    return readFileSync(new URL('../../src/app/BookmarkFeatureProvider.tsx', import.meta.url), 'utf8');
  }

  it('runtime 通过注入的订阅建立 canonical 偏好，并在卸载时退订', async () => {
    // 门控/桥是纯模块，这里直接驱动其公开接口验证行为，而不是断言源码里出现过某个函数名。
    const { connectBookmarkPreferences } = await import('@/app/bookmark-preference-bridge');
    const source = {
      applied: [] as unknown[],
      applyPreferences: vi.fn(async (next: unknown) => { source.applied.push(next); }),
    };
    const listeners: Array<(preferences: ReturnType<typeof createDefaultBookmarkPreferences>) => void> = [];
    const unsubscribe = vi.fn();
    const initial = { ...createDefaultBookmarkPreferences(), enabled: true };
    const changed: unknown[] = [];
    const bridge = connectBookmarkPreferences({
      subscribe: (next) => {
        listeners.push(next);
        return unsubscribe;
      },
      source: source as never,
      initial,
      onChange: (preferences) => changed.push(preferences),
      interruptEnable: () => {},
      onError: () => {},
    });

    // 观察器首发是当前快照，不应重复应用。
    listeners[0]?.({ ...initial });
    expect(source.applyPreferences).not.toHaveBeenCalled();

    listeners[0]?.({ ...initial, enabled: false });
    expect(source.applyPreferences).toHaveBeenCalledTimes(1);
    expect(source.applied[0]).toMatchObject({ enabled: false, mode: 'region', hiddenRules: [] });
    expect(changed).toHaveLength(1);

    // 重复投递同一偏好不再写入。
    listeners[0]?.({ ...initial, enabled: false });
    expect(source.applyPreferences).toHaveBeenCalledTimes(1);

    bridge.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    // 退订后迟到的投递不再应用。
    listeners[0]?.({ ...initial, enabled: true });
    expect(source.applyPreferences).toHaveBeenCalledTimes(1);
  });

  it('观察器读取/校验失败经 onError 上报，不静默降级为默认值', async () => {
    const { connectBookmarkPreferences } = await import('@/app/bookmark-preference-bridge');
    const source = { applyPreferences: vi.fn(async () => {}) };
    let deliverError: ((cause: unknown) => void) | null = null;
    const errors: unknown[] = [];
    const bridge = connectBookmarkPreferences({
      subscribe: (_next, onError) => { deliverError = onError; return () => {}; },
      source: source as never,
      initial: createDefaultBookmarkPreferences(),
      onChange: () => {},
      interruptEnable: () => {},
      onError: (cause) => errors.push(cause),
    });
    deliverError!(new Error('设置行损坏'));
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('设置行损坏');
    // 失败不触发任何数据源写入，也不伪造默认偏好。
    expect(source.applyPreferences).not.toHaveBeenCalled();
    bridge.dispose();
  });

  it('provider 的界面快照与 bindRule 使用 canonical 偏好而不是可能过期的 data.settings', () => {
    const provider = providerSource();
    expect(provider).toContain('preferencesRef.current.hiddenRules.find');
    // 视图快照只接受 canonical preferences 与其 intentEnabled。
    expect(provider).toContain('intentEnabled: preferences.enabled,');
    expect(provider).toContain('    preferences,');
    expect(provider).not.toContain('intentEnabled: data.settings.bookmarks.enabled');
    // 观察失败必须显式可见，不静默吞掉。
    expect(provider).toContain('subscribe: data.subscribeBookmarkPreferences');
    expect(provider).toContain('if (activeRef.current) setActionError(errorMessage(cause));');
  });

  it('跨页真实关闭会推进 enableToken，迟到的授权结果不再持久化', async () => {
    const { createBookmarkPreferenceGate, reconcileBookmarkPreferences } =
      await import('@/app/bookmark-preference-gate');
    const initial = { ...createDefaultBookmarkPreferences(), enabled: false };
    const gate = createBookmarkPreferenceGate(initial);
    let token = 0;
    let applied: unknown[] = [];
    const accept = (enabled: boolean) => reconcileBookmarkPreferences({
      gate,
      next: { ...initial, enabled },
      origin: 'observer',
      applySource: (preferences) => { applied.push(preferences.enabled); },
      interruptEnable: () => { token += 1; },
      onError: () => { throw new Error('不应失败'); },
    });

    // A 页：首发 false（授权前快照）不打断，用户随即点启用。
    accept(false);
    expect(token).toBe(0);
    // B 页提交启用 → A 看到 true。
    accept(true);
    expect(applied).toEqual([true]);
    // B 页随即关闭 → A 必须作废在途授权，避免迟到的 granted 写回 true。
    accept(false);
    expect(token).toBe(1);
    expect(applied).toEqual([true, false]);
    // 重复的 false 不再推进 token，也不重复写入。
    accept(false);
    expect(token).toBe(1);
    expect(applied).toEqual([true, false]);
  });

  it('bridge 在已提交 true → false 时先打断授权再清空数据源（真实订阅回调顺序）', async () => {
    const { connectBookmarkPreferences } = await import('@/app/bookmark-preference-bridge');
    const order: string[] = [];
    const source = {
      applyPreferences: vi.fn(async (next: { enabled: boolean }) => { order.push(`apply:${next.enabled}`); }),
    };
    let deliver: ((preferences: ReturnType<typeof createDefaultBookmarkPreferences>) => void) | null = null;
    const initial = createDefaultBookmarkPreferences();
    const bridge = connectBookmarkPreferences({
      subscribe: (next) => { deliver = next; return () => {}; },
      source: source as never,
      initial,
      onChange: () => {},
      interruptEnable: () => { order.push('interrupt'); },
      onError: () => {},
    });

    // 首发 false 不打断、不应用。
    deliver!({ ...initial });
    expect(order).toEqual([]);
    deliver!({ ...initial, enabled: true });
    expect(order).toEqual(['apply:true']);
    deliver!({ ...initial, enabled: false });
    // 打断发生在数据源清空之前：provider 的 enableToken 先失效，随后本实例 clear 排队。
    expect(order).toEqual(['apply:true', 'interrupt', 'apply:false']);
    bridge.dispose();
  });
});
