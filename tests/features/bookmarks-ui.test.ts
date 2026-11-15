import { createElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { BookmarkContextProvider, useBookmarks, useBookmarksRequired } from '@/app/bookmark-context';
import type { BookmarkHiddenRule } from '@/domain/bookmark-preferences';
import { BookmarkFolderDialog, emptyLayerKind, entriesFor, locate } from '@/features/bookmarks/BookmarkFolderDialog';
import { BookmarkFolderHost, canRenderBookmarkContent, nextExternalFolderRequest, nextFolderHostState, type BookmarkFolderHostState } from '@/features/bookmarks/BookmarkFolderHost';
import { BookmarkRegion, collectRegionEntries } from '@/features/bookmarks/BookmarkRegion';
import { BookmarkRow, BookmarkSeparatorRow } from '@/features/bookmarks/BookmarkRow';
import { BookmarkSettingsPanel } from '@/features/bookmarks/BookmarkSettingsPanel';
import { BookmarkTreeManager, activeRuleForNode, activeRulesForNode, collectBookmarkTreeRows, hiddenRuleIdsArg, rulesHideNode, rulesToUnhide } from '@/features/bookmarks/BookmarkTreeManager';
import {
  bookmarkAddressState, bookmarkBackShortcutKey, bookmarkCanOpen, bookmarkChildSegments,
  bookmarkIsEditableTarget, bookmarkParentFolderId, bookmarkPendingRuleCount,
  type BookmarkContextValue, type BookmarkNodeView, type BookmarkRootView,
  type BookmarkRuleMatch, type BookmarkViewSnapshot,
} from '@/features/bookmarks/bookmark-view';

// 结构性/静态渲染验证：不启动浏览器、不接触真实扩展 API、不请求权限。
// 真实扩展中的书签读取、权限弹窗与撤销事件仍需 Chrome/Firefox 各自验收。

vi.mock('@/components/ui/alert-dialog', () => {
  const container = ({ children }: { readonly children?: ReactNode }) => createElement('div', null, children);
  return Object.fromEntries(['AlertDialog', 'AlertDialogAction', 'AlertDialogCancel', 'AlertDialogContent',
    'AlertDialogDescription', 'AlertDialogFooter', 'AlertDialogHeader', 'AlertDialogTitle'].map((key) => [key, container]));
});

// Base UI 弹层在服务端渲染时只渲染 portal 占位；这里替换为普通容器，
// 只验证弹层内部结构与文案，不改变运行时组件本身。
vi.mock('@/components/ui/dialog', () => {
  const container = ({ children }: { readonly children?: ReactNode }) => createElement('div', null, children);
  // 标题保留传入的 DOM 属性（尤其是 tabindex），才能断言返回后可供程序聚焦的标题节点。
  const title = ({ children, ...props }: { readonly children?: ReactNode } & Record<string, unknown>) =>
    createElement('div', { ...props, 'data-dialog-title': 'true' }, children);
  return {
    ...Object.fromEntries(['Dialog', 'DialogContent', 'DialogDescription',
      'FloatingDialogContent', 'DialogClose', 'DialogFooter', 'DialogHeader', 'DialogTrigger'].map((key) => [key, container])),
    DialogTitle: title,
  };
});

const REGION_TITLE = '浏览器收藏夹';

function node(overrides: Partial<BookmarkNodeView> & Pick<BookmarkNodeView, 'nodeId' | 'title'>): BookmarkNodeView {
  return {
    kind: 'bookmark',
    url: 'https://example.com/',
    path: ['书签栏', overrides.title],
    children: [],
    ...overrides,
  };
}

function folder(overrides: Partial<BookmarkNodeView> & Pick<BookmarkNodeView, 'nodeId' | 'title'>): BookmarkNodeView {
  return { ...node(overrides), kind: 'folder', url: null, children: overrides.children ?? [] };
}

const FOLDER_NODE = folder({ nodeId: 'new-id', title: '工作', path: ['书签栏', '工作'] });

function root(overrides: Partial<BookmarkRootView> & Pick<BookmarkRootView, 'nodeId' | 'title'>): BookmarkRootView {
  return {
    path: [overrides.title],
    children: overrides.children ?? [],
    ...overrides,
  };
}

function rule(overrides: Partial<BookmarkHiddenRule> & Pick<BookmarkHiddenRule, 'ruleId' | 'targetId' | 'path'>): BookmarkHiddenRule {
  return { kind: 'folder', hidden: true, updatedAt: 1, ...overrides };
}

/**
 * 构造 depth 层文件夹链的合法 fixture（1 个根 + depth 层嵌套文件夹）。
 *
 * 迭代构建，测试自身不使用递归，避免把测试辅助函数的栈问题误当成业务缺陷。
 */
function deepChain(depth: number): { readonly roots: readonly BookmarkRootView[]; readonly lastId: string } {
  const pathAt = (level: number): string[] => [
    '书签栏', ...Array.from({ length: level }, (_, index) => `层${index + 1}`),
  ];
  let child: BookmarkNodeView = folder({ nodeId: `f${depth}`, title: `层${depth}`, path: pathAt(depth) });
  for (let level = depth - 1; level >= 1; level -= 1) {
    child = folder({ nodeId: `f${level}`, title: `层${level}`, path: pathAt(level), children: [child] });
  }
  return {
    roots: [root({ nodeId: '1', title: '书签栏', path: ['书签栏'], children: [child] })],
    lastId: `f${depth}`,
  };
}

function snapshot(overrides: Partial<BookmarkViewSnapshot> = {}): BookmarkViewSnapshot {
  return {
    status: 'ready',
    permission: 'granted',
    enabled: true,
    mode: 'region',
    showInSearch: true,
    regionVisible: true,
    roots: [],
    hiddenRules: [],
    hiddenNodeIds: [],
    ruleMatches: [],
    error: null,
    actionError: null,
    readAt: 1_700_000_000_000,
    busy: false,
    folderRequest: null,
    ...overrides,
  };
}

function context(value: BookmarkViewSnapshot): BookmarkContextValue {
  return {
    snapshot: value,
    requestEnable: vi.fn(),
    disable: vi.fn(),
    retry: vi.fn(),
    updateMode: vi.fn(),
    updateSearch: vi.fn(),
    setRegionVisible: vi.fn(),
    setHidden: vi.fn(),
    bindRule: vi.fn(),
    deleteRule: vi.fn(),
    clearCache: vi.fn(),
    openBookmark: vi.fn(),
    openFolder: vi.fn(),
  };
}

describe('只读行与不可用地址', () => {
  it('缺失地址与缺协议地址标记不可打开，可用地址不受影响', () => {
    expect(bookmarkAddressState(null)).toBe('missing');
    expect(bookmarkAddressState('   ')).toBe('missing');
    expect(bookmarkAddressState('not a url')).toBe('malformed');
    // 全协议保留：只要带 scheme 即可交给浏览器尝试。
    expect(bookmarkAddressState('javascript:alert(1)')).toBe('usable');

    const missing = node({ nodeId: 'missing', title: '缺地址', url: null });
    const broken = node({ nodeId: 'broken', title: '坏地址', url: 'not a url' });
    const script = node({ nodeId: 'script', title: '脚本', url: 'javascript:alert(1)' });
    expect(bookmarkCanOpen(missing)).toBe(false);
    expect(bookmarkCanOpen(broken)).toBe(false);
    expect(bookmarkCanOpen(script)).toBe(true);
    // 文件夹可进入，分隔符不可交互。
    expect(bookmarkCanOpen(folder({ nodeId: 'f', title: '文件夹' }))).toBe(true);
    expect(bookmarkCanOpen(node({ nodeId: 's', title: '分隔线', kind: 'separator', url: null }))).toBe(false);
  });

  it('区域视图仍显示缺地址条目，但按钮标记 aria-disabled 且不写地址', () => {
    const bad = node({ nodeId: 'bad', title: '缺地址条目', url: null });
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ roots: [root({ nodeId: '1', title: '书签栏', children: [bad] })] })),
    }));
    expect(html).toContain('缺地址条目');
    expect(html).toContain('地址缺失 · 无法打开');
    expect(html).toContain('aria-disabled="true"');
    // 只读行不渲染可执行链接属性。
    expect(html).not.toContain('href=');
  });

  it('缺地址行的点击守卫只包住 onActivate，分隔符不可交互', () => {
    // 没有 DOM 渲染器时无法模拟点击；这里直接断言渲染结果与源码中的唯一守卫点，
    // 避免出现「先调用打开、再判断不可用」的路径。
    const missing = node({ nodeId: 'missing', title: '缺地址', url: null });
    const broken = node({ nodeId: 'broken', title: '坏地址', url: 'not a url' });
    for (const target of [missing, broken]) {
      const html = renderToStaticMarkup(createElement(BookmarkRow, {
        node: target, stale: false, onActivate: vi.fn(),
      }));
      expect(html).toContain('aria-disabled="true"');
      expect(html).not.toContain('href=');
    }

    const source = readFileSync(new URL('../../src/features/bookmarks/BookmarkRow.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onClick={() => { if (!unusable) onActivate(node); }}');
    expect(source.match(/onActivate\(node\)/g)).toHaveLength(1);

    const separator = renderToStaticMarkup(createElement(BookmarkSeparatorRow));
    expect(separator).toContain('role="separator"');
    expect(separator).not.toContain('tabindex');
    expect(separator).not.toContain('href=');
  });

  it('文件夹模式对不可用地址的格子同样禁用，不提供隐藏单条链接的入口', () => {
    const bad = node({ nodeId: 'bad', title: '缺地址条目', url: 'not a url' });
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ mode: 'folder',
        roots: [root({ nodeId: '1', title: '书签栏', children: [bad] })] })),
    }));
    expect(html).toContain('地址不完整 · 无法打开');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href=');
    // 网格点击守卫在调用 openBookmark 之前返回。
    const source = readFileSync(new URL('../../src/features/bookmarks/BookmarkRegion.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if (unusable) return;');
  });
});

describe('文件夹视图的过期标注', () => {
  const roots = [root({
    nodeId: '1', title: '书签栏',
    children: [
      node({ nodeId: 'a', title: '根直链' }),
      folder({ nodeId: 'f', title: '工作', path: ['书签栏', '工作'] }),
      node({ nodeId: 'sep', title: '', kind: 'separator', url: null, path: ['书签栏'] }),
    ],
  })];

  it('stale 时每个非分隔符格子都标注「上次读取」，分隔符不标', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ mode: 'folder', status: 'stale', error: '本次读取失败', roots })),
    }));
    const gridStart = html.indexOf('aria-label="浏览器收藏夹根的直接子项"');
    expect(gridStart).toBeGreaterThanOrEqual(0);
    const grid = html.slice(gridStart);
    // 两个格子：根直链与工作文件夹。
    expect(grid.match(/aria-label="[^"]*，(书签|文件夹)，[^"]*"/g)).toHaveLength(2);
    expect(grid.match(/>上次读取</g)).toHaveLength(2);
    // 分隔符不是格子，没有过期标注。
    expect(grid).toContain('role="separator"');
  });

  it('ready 时格子不标注「上次读取」', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ mode: 'folder', roots })),
    }));
    const grid = html.slice(html.indexOf('aria-label="浏览器收藏夹根的直接子项"'));
    expect(grid).not.toContain('上次读取');
  });
});

describe('文件夹模式顶层空状态', () => {
  const NO_CONTENT = '浏览器收藏夹里没有可显示的条目';
  const HIDDEN_COVERED = '当前所有条目都被隐藏规则覆盖';
  const RECOVER = '可在设置「浏览器收藏夹 → 完整收藏夹树与隐藏规则」中恢复显示。';
  const ALL_HIDDEN = '全部浏览器根都已隐藏';
  const EMPTY_BROWSER = '浏览器里还没有可显示的收藏夹';

  const renderGrid = (roots: readonly BookmarkRootView[], hiddenNodeIds: readonly string[] = []) =>
    renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ mode: 'folder', roots, hiddenNodeIds })),
    }));

  it('根存在但都为空时如实说没有可显示内容，不写被隐藏', () => {
    const html = renderGrid([
      root({ nodeId: '1', title: '书签栏', children: [] }),
      root({ nodeId: '2', title: '其他书签', children: [] }),
    ]);
    expect(html).toContain(NO_CONTENT);
    expect(html).not.toContain(HIDDEN_COVERED);
    expect(html).not.toContain(RECOVER);
    expect(html).not.toContain(ALL_HIDDEN);
    expect(html).not.toContain(EMPTY_BROWSER);
  });

  it('可见根只剩分隔符时同样按没有可显示内容处理', () => {
    const html = renderGrid([root({ nodeId: '1', title: '书签栏', children: [
      node({ nodeId: 'sep', title: '', kind: 'separator', url: null, path: ['书签栏'] }),
    ] })]);
    expect(html).toContain(NO_CONTENT);
    expect(html).not.toContain(HIDDEN_COVERED);
    expect(html).not.toContain(RECOVER);
  });

  it('全部根被隐藏但原本为空时不算隐藏了内容', () => {
    const html = renderGrid([
      root({ nodeId: '1', title: '书签栏', children: [] }),
      root({ nodeId: '2', title: '其他书签', children: [] }),
    ], ['1', '2']);
    expect(html).toContain(NO_CONTENT);
    expect(html).not.toContain(ALL_HIDDEN);
    expect(html).not.toContain(HIDDEN_COVERED);
    expect(html).not.toContain(RECOVER);
  });

  it('四类顶层空状态文案互斥：全根隐藏 / 隐藏致空 / 无内容 / 空树', () => {
    const allHidden = renderGrid([
      root({ nodeId: '1', title: '书签栏', children: [node({ nodeId: 'a', title: '一根书签' })] }),
    ], ['1']);
    expect(allHidden).toContain(ALL_HIDDEN);
    expect(allHidden).toContain(RECOVER);
    expect(allHidden).not.toContain(HIDDEN_COVERED);
    expect(allHidden).not.toContain(NO_CONTENT);

    const childHidden = renderGrid([
      root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] }),
    ], ['new-id']);
    expect(childHidden).toContain(HIDDEN_COVERED);
    expect(childHidden).toContain(RECOVER);
    expect(childHidden).not.toContain(ALL_HIDDEN);
    expect(childHidden).not.toContain(NO_CONTENT);

    const noContent = renderGrid([root({ nodeId: '1', title: '书签栏', children: [] })]);
    expect(noContent).toContain(NO_CONTENT);
    expect(noContent).not.toContain(HIDDEN_COVERED);

    const trulyEmpty = renderGrid([]);
    expect(trulyEmpty).toContain(EMPTY_BROWSER);
    expect(trulyEmpty).not.toContain(HIDDEN_COVERED);
    expect(trulyEmpty).not.toContain(RECOVER);
    expect(trulyEmpty).not.toContain(NO_CONTENT);
  });
});

describe('权限与状态不显示树', () => {
  const populated = snapshot({
    roots: [root({ nodeId: '1', title: '书签栏', children: [node({ nodeId: 'a', title: '私有书签' })] })],
  });

  it.each([
    ['关闭', snapshot({ status: 'disabled', enabled: false, permission: 'unknown' }), null],
    ['撤销/未授权', { ...populated, status: 'permission-missing' as const, permission: 'denied' as const }, '需要重新允许读取收藏夹'],
    ['读取中', { ...populated, status: 'loading' as const }, '正在读取'],
  ])('%s 时不渲染任何书签标题', (_label, value, expected) => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, { bookmarks: context(value) }));
    expect(html).not.toContain('私有书签');
    if (expected === null) {
      expect(html).toBe('');
    } else {
      expect(html).toContain(expected);
    }
  });

  it('读取失败且无缓存时给出错误与重试，而不是空收藏夹', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ status: 'error', error: '读取超时' })),
    }));
    expect(html).toContain('读取失败');
    expect(html).toContain('读取超时');
    expect(html).toContain('重新读取');
    expect(html).not.toContain('浏览器里还没有可显示的收藏夹');
  });

  it('区域视图在权限缺失时提供直接重新授权按钮', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ status: 'permission-missing', permission: 'denied', enabled: true })),
    }));
    expect(html).toContain('请求收藏夹权限');
    expect(html).toContain('授权后才会读取；拒绝则保持关闭。');
  });

  it('stale 时同时保留条目与「上次读取」标注', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context({ ...populated, status: 'stale', error: '本次读取失败' }),
    }));
    expect(html).toContain('私有书签');
    expect(html).toContain('上次读取');
    expect(html).toContain('本次读取失败');
  });
});

describe('隐藏规则按解析结果绑定与恢复', () => {
  const pathRule = rule({
    ruleId: 'rule-1', targetId: 'old-id', path: ['书签栏', '工作'], updatedAt: 50,
  });
  // 浏览器节点 ID 已变化，仅路径回退命中新节点。
  const pathMatch: BookmarkRuleMatch = {
    ruleId: 'rule-1', status: 'matched', nodeId: 'new-id',
    candidates: [{ nodeId: 'new-id', path: ['书签栏', '工作'], kind: 'folder' }],
  };

  it('路径回退命中时解析到同一 ruleId，不只按 targetId', () => {
    const active = activeRuleForNode([pathRule], [pathMatch], 'new-id');
    expect(active?.rule.ruleId).toBe('rule-1');
    expect(active?.matchedByPath).toBe(true);
    // 原始 targetId 已不存在于树中，按 targetId 查不到任何行。
    expect(activeRuleForNode([pathRule], [pathMatch], 'old-id')).toBeNull();
  });

  it('歧义匹配不生效，不会把行显示成已隐藏', () => {
    const ambiguous: BookmarkRuleMatch = { ruleId: 'rule-1', status: 'ambiguous', nodeId: null, candidates: [] };
    expect(activeRuleForNode([pathRule], [ambiguous], 'new-id')).toBeNull();
  });

  it('已隐藏的根与文件夹显示「恢复显示」，并保留完整路径', () => {
    const html = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({
        roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
        hiddenRules: [pathRule],
        ruleMatches: [pathMatch],
        hiddenNodeIds: ['new-id'],
      })),
    }));
    expect(html).toContain('恢复显示工作及其全部后代');
    expect(html).toContain('已按路径重新匹配');
    expect(html).toContain('书签栏 / 工作');
    // 管理器只列根与文件夹，单条书签不出现隐藏入口。
    expect(html).toContain('隐藏只作用于浏览器根与普通文件夹');
  });

  it('歧义规则进入待处理列表，提供绑定与删除，不猜测目标', () => {
    const html = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({
        roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
        hiddenRules: [pathRule],
        ruleMatches: [{
          ruleId: 'rule-1', status: 'ambiguous', nodeId: null,
          candidates: [
            { nodeId: 'new-id', path: ['书签栏', '工作'], kind: 'folder' },
            { nodeId: 'other', path: ['其他书签', '工作'], kind: 'folder' },
          ],
        }],
      })),
    }));
    expect(html).toContain('待处理规则');
    expect(html).toContain('路径有歧义');
    expect(html).toContain('绑定所选目标');
    expect(html).toContain('删除规则');
    expect(html).toContain('未指定前不会隐藏任何内容');
    expect(html).not.toContain('恢复显示');
  });

  // 同一浏览器节点被跨设备合并出多条规则是合法状态；领域层对任一 matched
  // hidden:true 都会隐藏节点，因此行状态必须由全部命中规则派生。
  const r1True = rule({ ruleId: 'r1', targetId: 'new-id', path: ['书签栏', '工作'], hidden: true, updatedAt: 100 });
  const r2False = rule({ ruleId: 'r2', targetId: 'new-id', path: ['书签栏', '工作'], hidden: false, updatedAt: 200 });
  const r2True = rule({ ruleId: 'r2', targetId: 'new-id', path: ['书签栏', '工作'], hidden: true, updatedAt: 200 });
  const matched = (ruleId: string): BookmarkRuleMatch => ({
    ruleId, status: 'matched', nodeId: 'new-id',
    candidates: [{ nodeId: 'new-id', path: ['书签栏', '工作'], kind: 'folder' }],
  });

  it('r1=true(r1@100) + r2=false(@200) 仍显示为已隐藏（不被最新规则骗过）', () => {
    expect(activeRuleForNode([r1True, r2False], [matched('r1'), matched('r2')], 'new-id')?.rule.ruleId).toBe('r2');
    // 行状态来自全部规则：任一 true 即隐藏。
    const html = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({
        roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
        hiddenRules: [r1True, r2False],
        ruleMatches: [matched('r1'), matched('r2')],
        hiddenNodeIds: ['new-id'],
      })),
    }));
    expect(html).toContain('恢复显示工作及其全部后代');
    expect(html).toContain('2 条规则');
  });

  it('恢复时一次性提交全部 hidden:true 规则 ID，不循环调用 setHidden', () => {
    const bookmarks = context(snapshot({
      roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
      hiddenRules: [r1True, r2True],
      ruleMatches: [matched('r1'), matched('r2')],
      hiddenNodeIds: ['new-id'],
    }));
    // SSR 无法点击；用纯 helper 证明 UI 一次提交全部 ID。
    const active = activeRulesForNode([r1True, r2True], [matched('r1'), matched('r2')], 'new-id');
    expect(rulesHideNode(active)).toBe(true);
    expect(rulesToUnhide(active).map((entry) => entry.rule.ruleId)).toEqual(['r1', 'r2']);

    // 源码守卫：不得在恢复路径上 for/forEach 地循环调用 setHidden。
    const source = readFileSync(new URL('../../src/features/bookmarks/BookmarkTreeManager.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/for\s*\([^)]*\)\s*\{[\s\S]{0,200}setHidden/);
    expect(source).toContain('bookmarks.setHidden(target, !row.hidden, row.hidden ? hiddenRuleIdsArg(row.rules) : undefined)');
    expect(bookmarks.setHidden).not.toHaveBeenCalled();
  });

  it('hiddenRuleIdsArg 单条传字符串、多条一次传数组、无可取消传 undefined', () => {
    const onlyR1 = activeRulesForNode([r1True, r2False], [matched('r1'), matched('r2')], 'new-id');
    expect(hiddenRuleIdsArg(onlyR1)).toBe('r1');

    const bothTrue = activeRulesForNode([r1True, r2True], [matched('r1'), matched('r2')], 'new-id');
    expect(hiddenRuleIdsArg(bothTrue)).toEqual(['r1', 'r2']);
    // 数组是回传给提供方的完整集合，不是只挑一条。
    expect(hiddenRuleIdsArg(bothTrue)).toHaveLength(2);

    const allFalse = activeRulesForNode([r2False], [matched('r2')], 'new-id');
    expect(hiddenRuleIdsArg(allFalse)).toBeUndefined();
    expect(hiddenRuleIdsArg([])).toBeUndefined();
  });

  it('单条规则恢复仍沿用单条 ruleId 参数，保持旧接口兼容', () => {
    const active = activeRulesForNode([r1True], [matched('r1')], 'new-id');
    expect(hiddenRuleIdsArg(active)).toBe('r1');
    expect(rulesToUnhide(active).map((entry) => entry.rule.ruleId)).toEqual(['r1']);
  });

  it('路径回退后同一节点仍按全部规则判断隐藏', () => {
    const pathA = rule({ ruleId: 'r1', targetId: 'stale-id', path: ['书签栏', '工作'], hidden: true, updatedAt: 10 });
    const pathB = rule({ ruleId: 'r2', targetId: 'stale-id', path: ['书签栏', '工作'], hidden: false, updatedAt: 20 });
    const active = activeRulesForNode([pathA, pathB], [matched('r1'), matched('r2')], 'new-id');
    expect(active.every((entry) => entry.matchedByPath)).toBe(true);
    expect(rulesHideNode(active)).toBe(true);
    expect(rulesToUnhide(active).map((entry) => entry.rule.ruleId)).toEqual(['r1']);
  });

  it('祖先隐藏不会被行内恢复动作伪装成已解除', () => {
    const html = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({
        roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
        hiddenNodeIds: ['1'],
      })),
    }));
    // 工作自身没有规则，只标注跟随父级隐藏，按钮仍是「隐藏」而不是「恢复」。
    expect(html).toContain('跟随父级隐藏');
    expect(html).toContain('隐藏工作及其全部后代');
    expect(html).not.toContain('恢复显示工作及其全部后代');
  });
});

describe('文件夹视图弹层', () => {
  it('默认从全部浏览器根的直接子项开始，提供完整路径面包屑且没有编辑入口', () => {
    const nested = folder({ nodeId: 'nested', title: '归档', path: ['书签栏', '工作', '归档'] });
    const info = folder({ nodeId: 'work', title: '工作', path: ['书签栏', '工作'], children: [nested] });
    const html = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({
        mode: 'folder',
        roots: [
          root({ nodeId: '1', title: '书签栏', children: [info] }),
          root({ nodeId: '2', title: '其他书签', children: [node({ nodeId: 'e', title: '其他站' })] }),
        ],
      })),
      open: true,
      initialFolderId: null,
      onOpenChange: vi.fn(),
    }));
    expect(html).toContain('浏览器收藏夹 · 只读');
    expect(html).toContain('全部收藏夹');
    expect(html).toContain('工作');
    expect(html).toContain('其他站');
    // 只读：没有新建/改名/移动/删除/排序控件（管理指引只说明去浏览器里完成）。
    expect(html).not.toMatch(/aria-label="[^"]*(新建|重命名|移动|删除|拖动)/);
    expect(html).not.toMatch(/<input\b/);
    expect(html).not.toContain('内容可编辑');
  });

  it('隐藏的根与文件夹不出现在弹层内容里', () => {
    const hiddenFolder = folder({ nodeId: 'secret', title: '私人收藏', path: ['书签栏', '私人收藏'] });
    const html = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({
        mode: 'folder',
        roots: [root({ nodeId: '1', title: '书签栏', children: [hiddenFolder] })],
        hiddenNodeIds: ['secret'],
      })),
      open: true,
      initialFolderId: null,
      onOpenChange: vi.fn(),
    }));
    expect(html).not.toContain('私人收藏');
    // 该层唯一的直接子项被隐藏：这是隐藏导致为空，不是空文件夹（原断言曾期待「此文件夹为空」）。
    expect(html).toContain('当前层条目均被隐藏');
    expect(html).not.toContain('此文件夹为空');
  });

  it('弹层标题可程序聚焦（tabindex=-1），标题随层级更新但仍是同一标题区域', () => {
    const allRoots = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({
        mode: 'folder',
        roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
      })),
      open: true,
      initialFolderId: null,
      onOpenChange: vi.fn(),
    }));
    expect(allRoots).toMatch(/<div[^>]*tabindex="-1"[^>]*>全部收藏夹<\/div>/);

    const atRoot = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({
        mode: 'folder',
        roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
      })),
      open: true,
      initialFolderId: '1',
      onOpenChange: vi.fn(),
    }));
    expect(atRoot).toMatch(/<div[^>]*tabindex="-1"[^>]*>书签栏<\/div>/);
    expect(atRoot).not.toMatch(/<div[^>]*tabindex="-1"[^>]*>全部收藏夹<\/div>/);
  });

  it('当前层条目都被隐藏时说明恢复路径，不误写成浏览器里新增内容', () => {
    // 根自身有一批直接子项，但全部被隐藏规则覆盖：不是空文件夹。
    const hiddenA = node({ nodeId: 'ha', title: '被隐藏一', path: ['书签栏', '被隐藏一'] });
    const hiddenB = folder({ nodeId: 'hb', title: '被隐藏二', path: ['书签栏', '被隐藏二'] });
    const html = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({
        mode: 'folder',
        roots: [root({ nodeId: '1', title: '书签栏', children: [hiddenA, hiddenB] })],
        hiddenNodeIds: ['ha', 'hb'],
      })),
      open: true,
      initialFolderId: '1',
      onOpenChange: vi.fn(),
    }));
    expect(html).toContain('当前层条目均被隐藏');
    expect(html).toContain('可在设置「浏览器收藏夹 → 完整收藏夹树与隐藏规则」中恢复显示。');
    expect(html).not.toContain('浏览器里新增内容后会出现在这里');
    expect(html).not.toContain('此文件夹为空');
  });

  it('真空文件夹保留「此文件夹为空」和没有新建入口的说明', () => {
    const empty = folder({ nodeId: 'empty', title: '空目录', path: ['书签栏', '空目录'] });
    const html = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({
        mode: 'folder',
        roots: [root({ nodeId: '1', title: '书签栏', children: [empty] })],
      })),
      open: true,
      initialFolderId: 'empty',
      onOpenChange: vi.fn(),
    }));
    expect(html).toContain('此文件夹为空');
    expect(html).toContain('当前文件夹在浏览器中没有内容；这里不提供新建入口。');
    expect(html).not.toContain('当前层条目均被隐藏');
  });

  it('全部根都被隐藏导致顶层为空时识别为隐藏，而不是真空', () => {
    const roots = [
      root({ nodeId: '1', title: '书签栏', children: [node({ nodeId: 'a', title: '一根书签' })] }),
      root({ nodeId: '2', title: '其他收藏夹', children: [node({ nodeId: 'b', title: '二根书签' })] }),
    ];
    const html = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({ mode: 'folder', roots, hiddenNodeIds: ['1', '2'] })),
      open: true,
      initialFolderId: null,
      onOpenChange: vi.fn(),
    }));
    expect(html).toContain('当前层条目均被隐藏');
    expect(html).toContain('完整收藏夹树与隐藏规则');
    expect(html).not.toContain('此文件夹为空');
    expect(html).not.toContain('当前文件夹在浏览器中没有内容');

    // 没有任何根的真正空树仍然是真空。
    const trulyEmpty = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({ mode: 'folder', roots: [] })),
      open: true,
      initialFolderId: null,
      onOpenChange: vi.fn(),
    }));
    expect(trulyEmpty).toContain('此文件夹为空');
    expect(trulyEmpty).not.toContain('当前层条目均被隐藏');
  });

  it('emptyLayerKind 按过滤前的直接子项区分真空与隐藏致空', () => {
    const hiddenA = node({ nodeId: 'ha', title: '被隐藏', path: ['书签栏', '被隐藏'] });
    const roots = [root({ nodeId: '1', title: '书签栏', children: [hiddenA] })];
    expect(emptyLayerKind(locate(roots, '1'), roots, new Set(['ha']))).toBe('hidden');
    expect(emptyLayerKind(locate(roots, '1'), roots, new Set())).toBe('empty');
    // 全部根被隐藏且根下确有内容时，顶层不是真空。
    expect(emptyLayerKind(locate(roots, null), roots, new Set(['1']))).toBe('hidden');
    // 隐藏一个本来就空的根没有隐藏任何内容，仍按真空处理。
    const emptyRoot = [root({ nodeId: '1', title: '书签栏', children: [] })];
    expect(emptyLayerKind(locate(emptyRoot, null), emptyRoot, new Set(['1']))).toBe('empty');
    expect(emptyLayerKind(locate([], null), [], new Set())).toBe('empty');
  });

  it('隐藏整根时其子项也不出现在文件夹视图与弹层顶层', () => {
    const regionHtml = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({
        mode: 'folder',
        roots: [root({ nodeId: '1', title: '书签栏', children: [node({ nodeId: 'a', title: '根内书签' })] })],
        hiddenNodeIds: ['1'],
      })),
    }));
    expect(regionHtml).not.toContain('根内书签');

    const dialogHtml = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({
        mode: 'folder',
        roots: [
          root({ nodeId: '1', title: '书签栏', children: [node({ nodeId: 'a', title: '根内书签' })] }),
          root({ nodeId: '2', title: '其他书签', children: [node({ nodeId: 'b', title: '别的书签' })] }),
        ],
        hiddenNodeIds: ['1'],
      })),
      open: true,
      initialFolderId: null,
      onOpenChange: vi.fn(),
    }));
    expect(dialogHtml).not.toContain('根内书签');
    expect(dialogHtml).toContain('别的书签');
  });
});

describe('浏览器根导航', () => {
  const WORK = folder({ nodeId: 'work', title: '工作', path: ['书签栏', '工作'] });
  const ROOTS: readonly BookmarkRootView[] = [
    root({ nodeId: '1', title: '书签栏', children: [WORK] }),
    root({ nodeId: '2', title: '其他书签', children: [node({ nodeId: 'b', title: '别的书签' })] }),
  ];

  // 最小复现：旧实现只把 root.children 放入栈，从不比较 root.nodeId，
  // 因此 locate('1') 落空并回退到「全部收藏夹」，根面包屑/返回/搜索根结果全部失效。
  it('locate 能定位浏览器根本身，而不是回退到全部根', () => {
    const location = locate(ROOTS, '1');
    expect(location.root?.nodeId).toBe('1');
    expect(location.node).toBeNull();
    expect(location.missing).toBe(false);
    expect(location.trail.map((entry) => entry.nodeId)).toEqual([null, '1']);
    expect(location.trail.map((entry) => entry.label)).toEqual(['全部收藏夹', '书签栏']);
  });

  it('locate 仍能定位任意层文件夹，并保留从根到目标的完整路径', () => {
    const deep = folder({ nodeId: 'deep', title: '归档', path: ['书签栏', '工作', '归档'] });
    const location = locate([
      root({ nodeId: '1', title: '书签栏', children: [
        folder({ nodeId: 'work', title: '工作', path: ['书签栏', '工作'], children: [deep] }),
      ] }),
    ], 'deep');
    expect(location.node?.nodeId).toBe('deep');
    expect(location.root?.nodeId).toBe('1');
    expect(location.trail.map((entry) => entry.nodeId)).toEqual([null, '1', 'work', 'deep']);
    expect(location.trail.map((entry) => entry.label)).toEqual(['全部收藏夹', '书签栏', '工作', '归档']);
  });

  it('entriesFor 在根层只显示该根的直接子项，保持顺序、分隔符与空文件夹', () => {
    const sep = node({ nodeId: 'sep', title: '', kind: 'separator', url: null, path: ['书签栏'] });
    const empty = folder({ nodeId: 'empty', title: '空目录', path: ['书签栏', '空目录'] });
    const roots = [
      root({ nodeId: '1', title: '书签栏', children: [WORK, sep, empty] }),
      root({ nodeId: '2', title: '其他书签', children: [node({ nodeId: 'b', title: '别的书签' })] }),
    ];
    const entries = entriesFor(locate(roots, '1'), roots, new Set());
    expect(entries.map((entry) => entry.nodeId)).toEqual(['work', 'sep', 'empty']);
    expect(entries.map((entry) => entry.kind)).toEqual(['folder', 'separator', 'folder']);
    expect(entries.some((entry) => entry.nodeId === 'b')).toBe(false);
  });

  it('根层弹层标题与路径是根自身，返回按钮回到全部收藏夹而不跳过根', () => {
    const html = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({ mode: 'folder', roots: ROOTS })),
      open: true,
      initialFolderId: '1',
      onOpenChange: vi.fn(),
    }));
    expect(html).toContain('当前路径：书签栏');
    expect(html).toContain('书签栏');
    expect(html).toContain('工作');
    // 根层只列该根子项，不混入其他根。
    expect(html).not.toContain('别的书签');
    // 面包屑：全部收藏夹可点击，根是当前页。
    expect(html).toMatch(/<button[^>]*>全部收藏夹<\/button>/);
    expect(html).toMatch(/aria-current="page"[^>]*>书签栏</);
    // 根层之上是「全部收藏夹」，Esc 与返回按钮都回到上一层（不是关闭整层）。
    expect(html).toContain('Esc 返回上一级');
    expect(html).toContain('返回');
  });

  it('深层弹层返回路径保留根层，Esc 回退一层', () => {
    const deep = folder({ nodeId: 'deep', title: '归档', path: ['书签栏', '工作', '归档'] });
    const roots = [
      root({ nodeId: '1', title: '书签栏', children: [
        folder({ nodeId: 'work', title: '工作', path: ['书签栏', '工作'], children: [deep] }),
      ] }),
    ];
    const html = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({ mode: 'folder', roots })),
      open: true,
      initialFolderId: 'deep',
      onOpenChange: vi.fn(),
    }));
    expect(html).toContain('当前路径：书签栏 / 工作 / 归档');
    expect(html).toContain('Esc 返回上一级');
    expect(html).toMatch(/<button[^>]*>书签栏<\/button>/);
    expect(html).toMatch(/<button[^>]*>工作<\/button>/);
  });

  it('隐藏根不可通过根导航继续展示，安全回退到全部根且不含其内容', () => {
    const location = locate(ROOTS, '1', new Set(['1']));
    expect(location.root).toBeNull();
    expect(location.missing).toBe(true);
    expect(location.trail.map((entry) => entry.nodeId)).toEqual([null]);

    const html = renderToStaticMarkup(createElement(BookmarkFolderDialog, {
      bookmarks: context(snapshot({ mode: 'folder', roots: ROOTS, hiddenNodeIds: ['1'] })),
      open: true,
      initialFolderId: '1',
      onOpenChange: vi.fn(),
    }));
    expect(html).not.toContain('工作');
    expect(html).toContain('别的书签');
    // 不猜测目标：仍然显示「全部收藏夹」层。
    expect(html).toMatch(/aria-current="page"[^>]*>全部收藏夹</);
  });

  it('隐藏文件夹及其后代不可通过既有导航继续展示', () => {
    const deep = folder({ nodeId: 'deep', title: '深层', path: ['书签栏', '工作', '深层'] });
    const roots = [
      root({ nodeId: '1', title: '书签栏', children: [
        folder({ nodeId: 'work', title: '工作', path: ['书签栏', '工作'], children: [deep] }),
      ] }),
    ];
    expect(locate(roots, 'work', new Set(['work'])).missing).toBe(true);
    expect(locate(roots, 'deep', new Set(['work'])).missing).toBe(true);
    expect(locate(roots, 'deep', new Set(['deep'])).missing).toBe(true);
    // 未隐藏时仍可定位。
    expect(locate(roots, 'deep', new Set()).node?.nodeId).toBe('deep');
  });

  it('失效目标回退到全部根，不留在上一层的错误位置', () => {
    const location = locate(ROOTS, 'no-such-node');
    expect(location.missing).toBe(true);
    expect(location.node).toBeNull();
    expect(location.root).toBeNull();
    expect(entriesFor(location, ROOTS, new Set()).map((entry) => entry.nodeId)).toEqual(['work', 'b']);
  });
});

describe('区域视图的未分类分组与顺序', () => {
  const SEP = node({ nodeId: 'sep', title: '', kind: 'separator', url: null, path: ['书签栏'] });
  const DIRECT = node({ nodeId: 'd1', title: '直链一', path: ['书签栏', '直链一'] });
  const DIRECT2 = node({ nodeId: 'd2', title: '直链二', path: ['书签栏', '直链二'] });
  const WORK = folder({ nodeId: 'work', title: '工作', path: ['书签栏', '工作'] });

  it('根直属链接按连续段包进「未分类」，且不跨过文件夹或分隔符', () => {
    const segments = bookmarkChildSegments([DIRECT, DIRECT2, WORK, SEP, node({ nodeId: 'd3', title: '直链三', path: ['书签栏', '直链三'] })]);
    expect(segments.map((segment) => segment.kind)).toEqual(['uncategorized', 'node', 'node', 'uncategorized']);
    const first = segments[0];
    expect(first?.kind === 'uncategorized' && first.entries.map((entry) => entry.nodeId)).toEqual(['d1', 'd2']);
    expect(segments[1]?.kind === 'node' && segments[1].node.nodeId).toBe('work');
    // 孤立分隔符保持原位，不被吞进「未分类」。
    expect(segments[2]?.kind === 'node' && segments[2].node.kind).toBe('separator');
  });

  it('区域实际渲染「未分类」+ 根完整路径，并按浏览器顺序出现', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({
        mode: 'region',
        roots: [root({ nodeId: '1', title: '书签栏', path: ['书签栏'], children: [DIRECT, WORK, SEP, DIRECT2] })],
      })),
    }));
    expect(html).toContain('未分类 · 书签栏');
    expect(html).toContain('role="group" aria-label="未分类，书签栏"');
    // 顺序：直链一 → 工作 → 分隔线 → 直链二（未被聚合到末尾）。
    const order = ['直链一', '工作', '浏览器分隔线', '直链二'].map((label) => html.indexOf(label));
    for (const index of order) expect(index).toBeGreaterThanOrEqual(0);
    expect(order).toEqual([...order].sort((left, right) => left - right));
    // 第二段直链自己也有独立「未分类」标题。
    expect(html.match(/未分类 · 书签栏/g)?.length).toBe(2);
  });

  it('普通文件夹仍原样逐层展开，缺地址与空文件夹不被丢弃', () => {
    const empty = folder({ nodeId: 'empty', title: '空目录', path: ['书签栏', '空目录'] });
    const broken = node({ nodeId: 'broken', title: '坏地址', url: '', path: ['书签栏', '工作', '坏地址'] });
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({
        mode: 'region',
        roots: [root({ nodeId: '1', title: '书签栏', children: [
          folder({ nodeId: 'work', title: '工作', path: ['书签栏', '工作'], children: [broken] }),
          empty,
        ] })],
      })),
    }));
    expect(html).toContain('工作');
    expect(html).toContain('坏地址');
    expect(html).toContain('地址缺失 · 无法打开');
    expect(html).toContain('空目录');
    // 区域内不出现隐藏单条链接的入口。
    expect(html).not.toContain('隐藏坏地址');
  });

  it('隐藏的根直属链接不进入「未分类」，隐藏文件夹不泄漏后代', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({
        mode: 'region',
        roots: [root({ nodeId: '1', title: '书签栏', children: [DIRECT, WORK] })],
        hiddenNodeIds: ['d1', 'work'],
      })),
    }));
    expect(html).not.toContain('直链一');
    expect(html).not.toContain('工作');
    // 根仍可见，但其下条目都被隐藏时给恢复引导，而不是「还没有收藏夹」。
    expect(html).toContain('此根下的条目都被隐藏规则覆盖');
    expect(html).toContain('完整收藏夹树与隐藏规则');
    expect(html).not.toContain('浏览器里还没有可显示的收藏夹');
  });

  it('全部根被隐藏时给恢复引导，而不是添加书签的误导', () => {
    const regionHtml = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ mode: 'region', roots: [root({ nodeId: '1', title: '书签栏', children: [DIRECT] })], hiddenNodeIds: ['1'] })),
    }));
    expect(regionHtml).toContain('全部浏览器根都已隐藏');
    expect(regionHtml).toContain('完整收藏夹树与隐藏规则');
    expect(regionHtml).not.toContain('浏览器里还没有可显示的收藏夹');

    const gridHtml = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ mode: 'folder', roots: [root({ nodeId: '1', title: '书签栏', children: [DIRECT] })], hiddenNodeIds: ['1'] })),
    }));
    expect(gridHtml).toContain('全部浏览器根都已隐藏');
    expect(gridHtml).not.toContain('浏览器里还没有可显示的收藏夹');
  });

  it('待确认隐藏规则数量在两种模式都可见、只出现一次并指向设置', () => {
    const rules = [
      rule({ ruleId: 'rule-a', targetId: 'gone', path: ['书签栏', '已删除'] }),
      rule({ ruleId: 'rule-b', targetId: 'old-work', path: ['书签栏', '工作'] }),
      rule({ ruleId: 'rule-c', targetId: 'dead', path: ['书签栏', '歧义'] }),
    ];
    const matches: readonly BookmarkRuleMatch[] = [
      { ruleId: 'rule-a', status: 'unmatched', nodeId: null, candidates: [] },
      { ruleId: 'rule-b', status: 'matched', nodeId: 'work', candidates: [] },
      { ruleId: 'rule-c', status: 'ambiguous', nodeId: null, candidates: [
        { nodeId: 'x', path: ['书签栏', '歧义'], kind: 'folder' },
        { nodeId: 'y', path: ['其他书签', '歧义'], kind: 'folder' },
      ] },
    ];
    // ambiguous 与 unmatched 都计入，matched 不计入。
    expect(bookmarkPendingRuleCount(rules, matches)).toBe(2);

    for (const mode of ['region', 'folder'] as const) {
      const html = renderToStaticMarkup(createElement(BookmarkRegion, {
        bookmarks: context(snapshot({
          mode,
          roots: [root({ nodeId: '1', title: '书签栏', children: [WORK] })],
          hiddenRules: rules,
          ruleMatches: matches,
        })),
      }));
      expect(html).toContain('2 条隐藏规则待确认');
      expect(html).toContain('完整收藏夹树与隐藏规则');
      // 区域级只渲染一次，不在模式内部重复。
      expect(html.match(/条隐藏规则待确认/g)?.length).toBe(1);
    }
  });

  it('没有待确认规则时两种模式都不显示数量提示', () => {
    for (const mode of ['region', 'folder'] as const) {
      const html = renderToStaticMarkup(createElement(BookmarkRegion, {
        bookmarks: context(snapshot({ mode, roots: [root({ nodeId: '1', title: '书签栏', children: [WORK] })] })),
      }));
      expect(html).not.toContain('条隐藏规则待确认');
    }
  });
  it('区域模型对深度 5000 的合法树也只做迭代遍历，末叶可达', () => {
    const { roots, lastId } = deepChain(5000);
    const entries = collectRegionEntries({
      nodes: roots[0]?.children ?? [],
      hidden: new Set(),
      collapsed: new Set(),
    });
    expect(entries).toHaveLength(5000);
    expect(entries[entries.length - 1]?.node.nodeId).toBe(lastId);
    expect(entries[entries.length - 1]?.depth).toBe(4999);
    // 深度逐层 +1，说明没有跳层或丢层。
    for (let index = 1; index < entries.length; index += 1) {
      expect(entries[index]?.depth).toBe((entries[index - 1] as { depth: number }).depth + 1);
    }
  });

  it('区域模型保留分隔符、书签与空文件夹，只过滤隐藏并遵循折叠', () => {
    const sep = node({ nodeId: 'sep', title: '', kind: 'separator', url: null, path: ['书签栏'] });
    const hiddenBookmark = node({ nodeId: 'hb', title: '被隐藏', path: ['书签栏', '被隐藏'] });
    const emptyFolder = folder({ nodeId: 'empty', title: '空目录', path: ['书签栏', '空目录'] });
    const collapsedFolder = folder({
      nodeId: 'closed', title: '已收起', path: ['书签栏', '已收起'],
      children: [node({ nodeId: 'inside', title: '内部', path: ['书签栏', '已收起', '内部'] })],
    });
    const entries = collectRegionEntries({
      nodes: [DIRECT, sep, hiddenBookmark, emptyFolder, collapsedFolder],
      hidden: new Set(['hb']),
      collapsed: new Set(['closed']),
    });
    expect(entries.map((entry) => entry.node.nodeId)).toEqual(['d1', 'sep', 'empty', 'closed']);
    expect(entries.map((entry) => entry.node.kind)).toEqual(['bookmark', 'separator', 'folder', 'folder']);
    // 展开的空文件夹要显示「此文件夹为空」占位；收起的文件夹不展开子项。
    expect(entries.find((entry) => entry.node.nodeId === 'empty')?.showEmptyNote).toBe(true);
    expect(entries.some((entry) => entry.node.nodeId === 'inside')).toBe(false);
  });

  it('区域模型只展开未折叠的文件夹，嵌套深度准确', () => {
    const work = folder({ nodeId: 'work2', title: '工作', path: ['书签栏', '工作'], children: [
      folder({ nodeId: 'deep2', title: '归档', path: ['书签栏', '工作', '归档'], children: [
        node({ nodeId: 'leaf2', title: '末叶', path: ['书签栏', '工作', '归档', '末叶'] }),
      ] }),
    ] });
    const entries = collectRegionEntries({ nodes: [work], hidden: new Set(), collapsed: new Set() });
    expect(entries.map((entry) => `${entry.node.nodeId}@${entry.depth}`))
      .toEqual(['work2@0', 'deep2@1', 'leaf2@2']);
    expect(entries.every((entry) => entry.expanded === true || entry.node.kind !== 'folder')).toBe(true);
  });

  it('多兄弟子树组装后层级不串味，顺序与递归渲染一致', () => {
    // 参照物：小深度下用递归构造期望的 preorder 序列（仅测试辅助，不代表运行时实现）。
    const nested = folder({ nodeId: 'g1', title: 'G1', path: ['书签栏', 'C1', 'G1'] });
    const c1 = folder({ nodeId: 'c1', title: 'C1', path: ['书签栏', 'C1'], children: [nested] });
    const g2 = folder({ nodeId: 'g2', title: 'G2', path: ['书签栏', 'C2', 'G2'] });
    const c2 = folder({ nodeId: 'c2', title: 'C2', path: ['书签栏', 'C2'], children: [g2] });
    const roots = [root({ nodeId: '1', title: '书签栏', children: [c1, c2] })];

    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ roots })),
    }));
    const order = [...html.matchAll(/data-bookmark-node-id="([^"]+)"/g)].map((match) => match[1]);
    expect(order).toEqual(['c1', 'g1', 'c2', 'g2']);
    // c1 与 c2 各有一个子层容器；g1/g2 是空文件夹，由「此文件夹为空」占位而不再包层。
    expect(html.match(/class="ml-6 flex flex-col border-l/g)?.length).toBe(2);
    expect(html.match(/此文件夹为空/g)?.length).toBe(2);
  });

  it('区域实际渲染深层末叶且嵌套层级与逐层展开一致', () => {
    const depth = 40;
    const { roots, lastId } = deepChain(depth);
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ roots })),
    }));
    // 末叶仍然被渲染出来（没有任何深度截断）。
    expect(html).toContain(`data-bookmark-node-id="${lastId}"`);
    expect(html).toContain(`层${depth}`);
    // 除最后两层外，每层都有一个带左侧竖线的嵌套容器。
    const wrappers = html.match(/class="ml-6 flex flex-col border-l/g)?.length ?? 0;
    expect(wrappers).toBe(depth - 1);
    // 渲染函数本身不得自调用（避免再引入同层递归）。
    const source = readFileSync(new URL('../../src/features/bookmarks/BookmarkRegion.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/renderNodes\(/);
    expect(source).not.toMatch(/const renderTree[^=]*=[\s\S]{0,400}renderTree\(/);
  });
});

describe('区域返回键与输入态保护', () => {
  it('Esc / 无修饰 Backspace 在非输入态才生效', () => {
    const base = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, isEditable: false };
    expect(bookmarkBackShortcutKey({ ...base, key: 'Escape' })).toBe(true);
    expect(bookmarkBackShortcutKey({ ...base, key: 'Backspace' })).toBe(true);
    expect(bookmarkBackShortcutKey({ ...base, key: 'Enter' })).toBe(false);
    expect(bookmarkBackShortcutKey({ ...base, key: 'Escape', isEditable: true })).toBe(false);
    expect(bookmarkBackShortcutKey({ ...base, key: 'Backspace', ctrlKey: true })).toBe(false);
    expect(bookmarkBackShortcutKey({ ...base, key: 'Backspace', shiftKey: true })).toBe(false);
    expect(bookmarkBackShortcutKey({ ...base, key: 'Backspace', altKey: true })).toBe(false);
  });

  it('父层只能是文件夹；根直属条目与顶层不导航', () => {
    const work = folder({ nodeId: 'work', title: '工作', path: ['书签栏', '工作'] });
    const deep = folder({ nodeId: 'deep', title: '归档', path: ['书签栏', '工作', '归档'] });
    const direct = node({ nodeId: 'd1', title: '直链', path: ['书签栏', '直链'] });
    expect(bookmarkParentFolderId([work, deep])).toBe('work');
    expect(bookmarkParentFolderId([work])).toBeNull();
    expect(bookmarkParentFolderId([direct])).toBeNull();
    expect(bookmarkParentFolderId([])).toBeNull();
  });

  it('输入控件与可编辑区域被识别，普通按钮不算输入态', () => {
    const el = (tag: string, closest: string | null) => ({
      closest: () => (closest === null ? null : { tagName: tag.toUpperCase() }),
    });
    expect(bookmarkIsEditableTarget(el('input', 'input') as unknown as EventTarget)).toBe(true);
    expect(bookmarkIsEditableTarget(el('button', null) as unknown as EventTarget)).toBe(false);
    expect(bookmarkIsEditableTarget(null)).toBe(false);
  });

  it('区域树容器绑定了 keydown 且行带有节点 ID 用于定位父级', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({
        roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
      })),
    }));
    expect(html).toContain('data-bookmark-node-id="new-id"');
    expect(html).toContain('aria-label="浏览器收藏夹分组"');
  });
});

describe('隐藏管理器状态区分', () => {
  it('读取中/读取失败/未授权/真实空树给不同文案', () => {
    const loading = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({ status: 'loading', roots: [] })),
    }));
    expect(loading).toContain('正在读取浏览器收藏夹');
    expect(loading).not.toContain('浏览器的收藏夹树为空');

    const failed = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({ status: 'error', error: '读取超时', roots: [] })),
    }));
    expect(failed).toContain('本次读取失败');
    expect(failed).toContain('读取超时');
    expect(failed).not.toContain('浏览器的收藏夹树为空');

    const denied = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({ status: 'permission-missing', permission: 'denied', roots: [] })),
    }));
    expect(denied).toContain('本机尚未授权读取收藏夹');

    const empty = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({ status: 'ready', roots: [] })),
    }));
    expect(empty).toContain('浏览器的收藏夹树为空');
  });

  it('disabled 状态不显示任何树或读取文案', () => {
    const html = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({ status: 'disabled', enabled: false, permission: 'unknown', roots: [] })),
    }));
    expect(html).toContain('启用后可在这里管理隐藏的根与文件夹');
    expect(html).not.toContain('浏览器的收藏夹树为空');
  });

  it('深度 5000 的合法树仍能生成完整行（不再递归爆栈）', () => {
    const { roots, lastId } = deepChain(5000);
    const rows = collectBookmarkTreeRows({ roots, rules: [], matches: [], hiddenIds: new Set() });
    expect(rows).toHaveLength(5001); // 1 根 + 5000 层文件夹
    expect(rows[0]?.kind).toBe('root');
    expect(rows[rows.length - 1]?.nodeId).toBe(lastId);
    expect(rows[rows.length - 1]?.depth).toBe(5000);
    // 保序：每层紧接上一层的祖先之后，深度单调不跳级。
    for (let index = 1; index < rows.length; index += 1) {
      expect(rows[index]?.depth).toBe((rows[index - 1] as { depth: number }).depth + 1);
    }
  });

  it('深度 5000 时祖先隐藏仍逐行标注覆盖且末叶可达', () => {
    const { roots, lastId } = deepChain(5000);
    const rows = collectBookmarkTreeRows({
      roots, rules: [], matches: [], hiddenIds: new Set([roots[0]?.children[0]?.nodeId ?? '']),
    });
    const tail = rows[rows.length - 1];
    expect(tail?.nodeId).toBe(lastId);
    expect(tail?.coveredByAncestor).toBe(true);
    // 被隐藏的那个文件夹自身不是「跟随祖先」，其后代才是。
    expect(rows[1]?.coveredByAncestor).toBe(false);
    expect(rows[2]?.coveredByAncestor).toBe(true);
  });

  it('忙碌时隐藏/绑定/删除按钮被禁用，撤销开关不受限', () => {
    const html = renderToStaticMarkup(createElement(BookmarkTreeManager, {
      bookmarks: context(snapshot({
        roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
        hiddenRules: [rule({ ruleId: 'rule-x', targetId: 'gone', path: ['书签栏', '已删除'] })],
        ruleMatches: [{
          ruleId: 'rule-x', status: 'ambiguous', nodeId: null,
          candidates: [
            { nodeId: 'a', path: ['书签栏', '已删除'], kind: 'folder' },
            { nodeId: 'b', path: ['其他书签', '已删除'], kind: 'folder' },
          ],
        }],
        busy: true,
      })),
    }));
    expect(html).toMatch(/disabled=""[^>]*aria-label="隐藏工作及其全部后代"/);
    // 待处理规则的两个写库按钮同样被禁用，避免被忙锁静默吞掉。
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>绑定所选目标<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>删除规则<\/button>/);

    // 撤销/关闭是安全方向，不受忙锁门控。
    const panel = renderToStaticMarkup(createElement(BookmarkContextProvider, {
      value: context(snapshot({ busy: true })),
      children: createElement(BookmarkSettingsPanel),
    }));
    expect(panel).not.toMatch(/<button[^>]*role="switch"[^>]*disabled/);
  });
});

describe('外部搜索请求的弹层宿主', () => {
  const ROOTS: readonly BookmarkRootView[] = [
    root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] }),
    root({ nodeId: '2', title: '其他书签', children: [node({ nodeId: 'b', title: '别的书签' })] }),
  ];

  it('每个 requestId 只消费一次：快照/数组更新不重复打开', () => {
    const first = { requestId: 7, nodeId: '1' };
    expect(nextExternalFolderRequest(null, first)).toBe(first);
    expect(nextExternalFolderRequest(7, first)).toBeNull();
    // 同一 requestId 但对象变化（provider 每次给出新数组）仍不重复消费。
    expect(nextExternalFolderRequest(7, { requestId: 7, nodeId: '1' })).toBeNull();
    // 新请求才消费。
    expect(nextExternalFolderRequest(7, { requestId: 8, nodeId: 'work' })?.nodeId).toBe('work');
    expect(nextExternalFolderRequest(7, null)).toBeNull();
  });

  it('关闭/撤销会作废弹层会话，重新启用不自动重开旧请求', () => {
    const request = { requestId: 7, nodeId: '1' };
    let state: BookmarkFolderHostState = { handledRequestId: null, target: null };

    // 打开：消费 7。
    state = nextFolderHostState(state, request, true);
    expect(state.handledRequestId).toBe(7);
    expect(state.target).toEqual(request);

    // 撤销权限：target 立即清空，且 7 记为已消费。
    state = nextFolderHostState(state, request, false);
    expect(state.target).toBeNull();
    expect(state.handledRequestId).toBe(7);

    // 重新启用（同一旧 request 仍在快照里）：不得自动重开。
    state = nextFolderHostState(state, request, true);
    expect(state.target).toBeNull();
    expect(state.handledRequestId).toBe(7);

    // 新的 requestId 仍能打开。
    state = nextFolderHostState(state, { requestId: 8, nodeId: 'work' }, true);
    expect(state.target).toEqual({ requestId: 8, nodeId: 'work' });

    // 关闭后请求为 null，也不残留 target。
    state = nextFolderHostState(state, null, false);
    expect(state.target).toBeNull();
  });

  it('只在启用且已授权时渲染内容，关闭/撤销立即不渲染', () => {
    expect(canRenderBookmarkContent(snapshot())).toBe(true);
    expect(canRenderBookmarkContent(snapshot({ status: 'stale' }))).toBe(true);
    expect(canRenderBookmarkContent(snapshot({ status: 'importing' }))).toBe(true);
    expect(canRenderBookmarkContent(snapshot({ status: 'loading' }))).toBe(false);
    expect(canRenderBookmarkContent(snapshot({ status: 'error' }))).toBe(false);
    expect(canRenderBookmarkContent(snapshot({ status: 'disabled', enabled: false }))).toBe(false);
    expect(canRenderBookmarkContent(snapshot({ status: 'permission-missing', permission: 'denied' }))).toBe(false);
  });

  it('没有提供方或不满足渲染条件时不渲染任何内容', () => {
    expect(renderToStaticMarkup(createElement(BookmarkFolderHost))).toBe('');

    const disabled = renderToStaticMarkup(createElement(BookmarkContextProvider, {
      value: context(snapshot({ status: 'disabled', enabled: false, roots: ROOTS,
        folderRequest: { requestId: 1, nodeId: '1' } })),
      children: createElement(BookmarkFolderHost),
    }));
    expect(disabled).toBe('');

    const revoked = renderToStaticMarkup(createElement(BookmarkContextProvider, {
      value: context(snapshot({ status: 'permission-missing', permission: 'denied', roots: ROOTS,
        folderRequest: { requestId: 2, nodeId: '1' } })),
      children: createElement(BookmarkFolderHost),
    }));
    expect(revoked).toBe('');
    expect(revoked).not.toContain('书签栏');
  });

  it('区域未挂载时宿主仍可接受根请求（布局隐藏场景）', () => {
    // 静态渲染无法触发 effect，这里用纯函数证明「根 request 是有效目标」，
    // 并断言宿主本身不依赖 BookmarkRegion 的挂载。
    const source = readFileSync(new URL('../../src/features/bookmarks/BookmarkFolderHost.tsx', import.meta.url), 'utf8');
    expect(source).toContain('export function BookmarkFolderHost()');
    expect(source).toContain('useBookmarks()');
    expect(source).not.toContain('BookmarkRegion');

    const location = locate(ROOTS, '1');
    expect(location.root?.nodeId).toBe('1');
    expect(entriesFor(location, ROOTS, new Set()).map((entry) => entry.nodeId)).toEqual(['new-id']);
  });

  it('区域内不再重复消费 folderRequest，避免同一请求开两个弹层', () => {
    const regionSource = readFileSync(new URL('../../src/features/bookmarks/BookmarkRegion.tsx', import.meta.url), 'utf8');
    expect(regionSource).not.toContain('folderRequest');
    expect(regionSource).not.toContain('handledRequest');
    // 区域内仍保留自己的本地点击弹层。
    expect(regionSource).toContain('<BookmarkFolderDialog');
  });
});

describe('设置分区顺序与接线', () => {
  function renderPanel(value: BookmarkViewSnapshot) {
    return renderToStaticMarkup(createElement(BookmarkContextProvider, {
      value: context(value), children: createElement(BookmarkSettingsPanel),
    }));
  }

  it('没有提供方时明确说明未接线，不显示开关或模式', () => {
    const html = renderToStaticMarkup(createElement(BookmarkSettingsPanel));
    expect(html).toContain('当前页面没有接入书签提供方');
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain('主页模式');
    expect(html).not.toContain('在搜索中显示浏览器收藏夹');
  });

  it('启用前说明出现在开关之前，且分区顺序为模式→搜索→隐藏→缓存状态→手动指引', () => {
    const html = renderPanel(snapshot({ status: 'disabled', enabled: false, permission: 'unknown' }));
    const explanation = html.indexOf('权限与隐私说明');
    const enableSwitch = html.indexOf('role="switch"');
    const mode = html.indexOf('主页模式');
    const search = html.indexOf('在搜索中显示浏览器收藏夹');
    const hidden = html.indexOf('完整收藏夹树与隐藏规则');
    const cache = html.indexOf('aria-label="本机缓存"');
    const guidance = html.indexOf('在浏览器中管理书签');
    for (const index of [explanation, enableSwitch, mode, search, hidden, cache, guidance]) {
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(explanation).toBeLessThan(enableSwitch);
    expect(enableSwitch).toBeLessThan(mode);
    expect(mode).toBeLessThan(search);
    expect(search).toBeLessThan(hidden);
    expect(hidden).toBeLessThan(cache);
    expect(cache).toBeLessThan(guidance);
  });

  it('没有来源/根选择控件，也没有额外的重置或清缓存入口', () => {
    const html = renderPanel(snapshot({
      roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
    }));
    expect(html).not.toMatch(/<select\b/);
    expect(html).not.toContain('选择来源');
    expect(html).not.toContain('选择根');
    // 保守决定：关闭/撤权自动清缓存，UI 不再提供清除或重置入口。
    expect(html).not.toContain('清除本机书签缓存');
    expect(html).not.toContain('清除缓存');
    expect(html).not.toContain('清除本机书签');
    expect(html).toContain('没有额外的清除或「重置书签」入口');
    // 缓存状态仍然只读可见。
    expect(html).toContain('上次读取：');
    expect(html).toContain('关闭功能或撤销权限会立即清除本机缓存');
  });

  it('区域排序与显隐只在布局分区，书签设置不重复提供区域开关', () => {
    const html = renderPanel(snapshot({
      roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
    }));
    expect(html).not.toContain('在主页显示浏览器收藏夹区域');
    expect(html).toContain('区域顺序与显隐只在「布局」分区调整');
    // 只保留功能开关与搜索开关两个 switch，不再有第三个区域显隐开关。
    expect(html.match(/role="switch"/g)?.length).toBe(2);
    expect(html).toContain('在搜索中显示浏览器收藏夹');
  });

  it('未授权时不显示树，并提供直接的重新授权按钮（无需先关闭再开启）', () => {
    const value = snapshot({
      status: 'permission-missing',
      permission: 'denied',
      roots: [root({ nodeId: '1', title: '书签栏', children: [node({ nodeId: 'a', title: '私有书签' })] })],
    });
    const bookmarks = context(value);
    const html = renderToStaticMarkup(createElement(BookmarkContextProvider, {
      value: bookmarks, children: createElement(BookmarkSettingsPanel),
    }));
    expect(html).not.toContain('私有书签');
    expect(html).toContain('本机尚未授权读取收藏夹');
    expect(html).toContain('重新允许读取收藏夹');

    // 直接调用 requestEnable：不要求先关闭开关。
    expect(bookmarks.disable).not.toHaveBeenCalled();
    bookmarks.requestEnable();
    expect(bookmarks.requestEnable).toHaveBeenCalledTimes(1);
    expect(bookmarks.disable).not.toHaveBeenCalled();
  });

  it('stale 时缓存分区只读说明过期状态，但不提供清缓存动作', () => {
    const html = renderPanel(snapshot({
      status: 'stale',
      error: '本次读取失败',
      roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })],
    }));
    expect(html).toContain('当前显示的是上次读取结果，可能已过期');
    expect(html).toContain('本次读取失败');
    expect(html).not.toContain('清除本机书签缓存');
  });

  it('未授权且功能未启用时仍显示重新授权按钮，不要求先关闭再开启', () => {
    const value = snapshot({
      status: 'permission-missing',
      permission: 'denied',
      enabled: false,
      roots: [root({ nodeId: '1', title: '书签栏', children: [node({ nodeId: 'a', title: '私有书签' })] })],
    });
    const html = renderPanel(value);
    expect(html).not.toContain('私有书签');
    expect(html).toContain('授权后才会读取；拒绝则保持关闭。');
    expect(html).toContain('重新允许读取收藏夹');
  });

  it('书签说明写明只读、不上传、不进 ZIP 与同步、不抓取图标', () => {
    const html = renderPanel(snapshot({ status: 'disabled', enabled: false, permission: 'unknown' }));
    for (const phrase of ['不会新增、修改、移动或删除任何书签', '不上传、不写日志',
      '不进入 ZIP 备份或同步快照', '不抓取 favicon', '只随同步传输']) {
      expect(html).toContain(phrase);
    }
  });

  it('本机开关 = 启用意图且已授权，撤权时不显示为已开但仍保留意图说明', () => {
    const granted = renderPanel(snapshot({ status: 'ready', permission: 'granted', enabled: true }));
    expect(granted).toMatch(/aria-checked="true"[^>]*aria-label="启用浏览器收藏夹"/);

    const revoked = renderPanel(snapshot({ status: 'permission-missing', permission: 'denied', enabled: true }));
    // 意图仍为 true，但本机开关必须是关闭。
    expect(revoked).toMatch(/aria-checked="false"[^>]*aria-label="启用浏览器收藏夹"/);
    expect(revoked).toContain('本机撤权后开关显示为关闭');
    expect(revoked).toContain('重新允许读取收藏夹');
  });

  it('首次拒绝授权时主状态写未授权，不伪装成用户主动关闭', () => {
    const html = renderPanel(snapshot({ status: 'disabled', enabled: false, permission: 'denied' }));
    expect(html).toContain('本机未授权 · 不会读取收藏夹');
    expect(html).not.toContain('未启用 · 本机不会读取收藏夹');
  });
});

describe('上下文契约', () => {
  it('没有提供方时可选读取返回 null，必须接线时明确失败', () => {
    let optional: BookmarkContextValue | null | undefined;
    function OptionalProbe() {
      optional = useBookmarks();
      return createElement('span', null, 'ok');
    }
    renderToStaticMarkup(createElement(OptionalProbe));
    expect(optional).toBeNull();

    let message = '未抛出';
    function RequiredProbe() {
      try {
        useBookmarksRequired();
      } catch (error) {
        message = (error as Error).message;
      }
      return createElement('span', null, 'ok');
    }
    renderToStaticMarkup(createElement(RequiredProbe));
    expect(message).toBe('浏览器收藏夹界面必须在 BookmarkContext 提供方内使用');
  });

  it('区域标题固定为「浏览器收藏夹」并带只读标记', () => {
    const html = renderToStaticMarkup(createElement(BookmarkRegion, {
      bookmarks: context(snapshot({ roots: [root({ nodeId: '1', title: '书签栏', children: [FOLDER_NODE] })] })),
    }));
    expect(html).toContain(REGION_TITLE);
    expect(html).toContain('浏览器拥有 · 只读');
    // 两种模式都不提供来源选择。
    expect(html).not.toContain('选择来源');
  });
});
