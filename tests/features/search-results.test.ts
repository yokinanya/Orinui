import { describe, expect, it, vi } from 'vitest';
import { buildSearchResults } from '@/features/search/build-search-results';
import { executeSearchSuggestion } from '@/features/search/execute-search-suggestion';
import { createDefaultSettings } from '@/domain/settings';
import { buildBookmarkSearchIndex, type BookmarkSearchNode, type BookmarkSearchProjection,
  type BookmarkSearchStatus } from '@/domain/local-search';
import { bookmarkSearchProjection, bookmarkSearchBridge } from '@/features/search/bookmark-search-adapter';
import type { BookmarkViewSnapshot, BookmarkNodeView } from '@/features/bookmarks/bookmark-view';

const CONTEXT = { now: new Date('2026-10-19T12:00:00Z'), timeZone: 'Asia/Hong_Kong' };

function bookmark(id: string, title: string, url: string | null = `https://${id}.example.com`): BookmarkSearchNode {
  return { id, parentId: 'bar', index: 0, title, url, kind: 'bookmark', unusable: false, children: [] };
}

function folder(id: string, title: string, children: readonly BookmarkSearchNode[], kind: 'root' | 'folder' = 'folder'): BookmarkSearchNode {
  return { id, parentId: null, index: 0, title, url: null, kind, unusable: false, children };
}

function projection(nodes: readonly BookmarkSearchNode[], status: BookmarkSearchStatus = 'ready'): BookmarkSearchProjection {
  return { tree: [folder('bar', '书签栏', nodes, 'root')], status, readAt: status === 'error' ? null : 1, error: null };
}

const PLAIN_SPELL = (value: string) => ({ full: value, initials: value });

/** 与运行时一致：书签索引由调用方按投影身份构建后传入结果生成器。 */
function bookmarks(status: BookmarkSearchStatus, tree: readonly BookmarkSearchNode[], showInSearch = true) {
  return { showInSearch, index: buildBookmarkSearchIndex(projection(tree, status), PLAIN_SPELL) };
}

function results(query: string) {
  return buildSearchResults({ query, settings: createDefaultSettings().search, context: CONTEXT,
    index: [], indexStatus: 'ready', indexError: null });
}

function bookmarkResults(query: string, status: BookmarkSearchStatus = 'ready',
  options: { readonly showInSearch?: boolean; readonly tree?: readonly BookmarkSearchNode[] } = {}) {
  return buildSearchResults({ query, settings: createDefaultSettings().search, context: CONTEXT,
    index: [], indexStatus: 'ready', indexError: null,
    bookmarks: bookmarks(status, options.tree ?? [folder('work', '工作', [bookmark('docs', '文档')])],
      options.showInSearch ?? true) });
}

function bookmarkOptions(query: string, status: BookmarkSearchStatus = 'ready',
  options: { readonly showInSearch?: boolean; readonly tree?: readonly BookmarkSearchNode[] } = {}) {
  return bookmarkResults(query, status, options).items
    .filter(({ kind }) => kind === 'bookmark' || kind === 'bookmark-folder');
}

describe('搜索结果和动作', () => {
  it('普通文字及裸编号不自动跳转，明确网址提供打开动作', () => {
    expect(results('owner/repo#123').defaultId).toBe('search');
    expect(results('普通文字').defaultId).toBe('search');
    expect(results('example.com').defaultId).toBe('navigation');
    expect(results('2.3').defaultId).toBe('search');
  });

  it('显式 gh 命令不产生普通搜索备选，非法参数不会外发', () => {
    const good = results('gh owner/repo#123');
    expect(good.items.some(({ kind }) => kind === 'search')).toBe(false);
    expect(good.items.find(({ id }) => id === good.defaultId)).toMatchObject({ kind: 'open',
      value: 'https://github.com/owner/repo/issues/123' });
    expect(results('gh owner/repo#wrong').items).toEqual([expect.objectContaining({ kind: 'error' })]);
    expect(results('GitHub').defaultId).toBe('search');
  });

  it('实例只回填，颜色结果有多个独立动作和唯一标识', () => {
    expect(results('?').items.every(({ kind }) => kind === 'fill')).toBe(true);
    const colors = results('#6750a4');
    const actions = colors.items.filter(({ section }) => section === 'tool');
    expect(actions.length).toBeGreaterThan(1);
    expect(new Set(actions.map(({ id }) => id)).size).toBe(actions.length);
    expect(actions.every(({ swatch }) => Boolean(swatch))).toBe(true);
  });

  it('关闭全部工具后问号明确显示未启用，不降级成网页搜索', () => {
    const search = createDefaultSettings().search;
    const settings = { ...search, customization: { ...search.customization, enabledTools: [] } };
    const output = buildSearchResults({ query: '?', settings, context: CONTEXT,
      index: [], indexStatus: 'ready', indexError: null });
    expect(output.items).toEqual([expect.objectContaining({ kind: 'status', label: '此快捷工具未启用' })]);
  });

});

describe('本地状态与动作执行', () => {
  it('索引加载与读取错误显式显示，关闭来源后不显示索引状态', () => {
    const input = { query: 'abc', settings: createDefaultSettings().search, context: CONTEXT, index: [] };
    expect(buildSearchResults({ ...input, indexStatus: 'error', indexError: 'IndexedDB failed' }).items)
      .toContainEqual(expect.objectContaining({ kind: 'error', detail: 'IndexedDB failed' }));
    expect(buildSearchResults({ ...input, indexStatus: 'loading', indexError: null }).items)
      .toContainEqual(expect.objectContaining({ kind: 'status' }));
    const settings = { ...input.settings, customization: { ...input.settings.customization, showSites: false, showFolders: false } };
    expect(buildSearchResults({ ...input, settings, indexStatus: 'loading', indexError: null }).items)
      .not.toContainEqual(expect.objectContaining({ kind: 'status' }));
  });

  it('复制失败直接抛错，不伪造成功或执行导航', async () => {
    const ports = { copy: vi.fn().mockRejectedValue(new Error('clipboard rejected')), open: vi.fn(),
      openFolder: vi.fn(), fill: vi.fn(), dismiss: vi.fn(), copied: vi.fn() };
    await expect(executeSearchSuggestion({ item: { id: 'copy', kind: 'copy', section: 'tool', label: '复制', detail: 'x', value: 'x' },
      targets: { search: 'current-tab', shortcut: 'new-tab' }, ports })).rejects.toThrow('clipboard rejected');
    expect(ports.copied).not.toHaveBeenCalled();
    expect(ports.open).not.toHaveBeenCalled();
    expect(ports.dismiss).not.toHaveBeenCalled();
  });

  it('来源决定打开目标，填入示例不打开或复制', async () => {
    const ports = { copy: vi.fn(), open: vi.fn(), openFolder: vi.fn(), fill: vi.fn(), dismiss: vi.fn(), copied: vi.fn() };
    const targets = { search: 'current-tab', shortcut: 'new-tab' } as const;
    const base = { id: 'action', label: 'action', detail: '', value: 'https://example.com' };
    await executeSearchSuggestion({ item: { ...base, section: 'site', kind: 'open' }, targets, ports });
    expect(ports.open).toHaveBeenCalledWith(base.value, 'new-tab');
    await executeSearchSuggestion({ item: { ...base, section: 'tool', kind: 'fill' }, targets, ports });
    expect(ports.fill).toHaveBeenCalledWith(base.value);
    expect(ports.open).toHaveBeenCalledTimes(1);
    expect(ports.copy).not.toHaveBeenCalled();
  });
});

describe('浏览器书签搜索结果', () => {
  it('书签结果带完整路径与来源，并入网站分区，文件夹结果单独标识', () => {
    const items = bookmarkResults('文档').items.filter(({ kind }) => kind === 'bookmark' || kind === 'bookmark-folder');
    expect(items.map(({ id, section }) => `${id}:${section}`)).toEqual(['bookmark:docs:site']);
    expect(items[0]).toMatchObject({ label: '文档', detail: '浏览器书签 · 书签栏 / 工作',
      value: 'https://docs.example.com', bookmarkNodeId: 'docs' });
    expect(items[0]!.id).toBe('bookmark:docs');
    const folders = bookmarkResults('工作').items.filter(({ kind }) => kind === 'bookmark-folder');
    expect(folders.map(({ id, section }) => `${id}:${section}`)).toEqual(['bookmark-folder:work:folder']);
    expect(folders[0]).toMatchObject({ label: '工作', detail: '浏览器书签 · 书签栏 / 工作', bookmarkNodeId: 'work' });
    expect(bookmarkResults('文档').defaultId).toBe('search');
  });

  it('没有地址或不可用的书签仍可搜索，但标记为不可激活', () => {
    const tree = [folder('empty', '坏书签', [], 'folder'),
      bookmark('blank', '坏书签', null)];
    const items = bookmarkResults('坏书签', 'ready', { tree }).items
      .filter(({ kind }) => kind === 'bookmark' || kind === 'bookmark-folder');
    const link = items.find(({ kind }) => kind === 'bookmark')!;
    expect(link).toMatchObject({ unavailable: true, value: '', bookmarkNodeId: 'blank',
      activationError: '此书签没有可用地址，无法打开' });
    expect(items.some(({ kind }) => kind === 'bookmark-folder')).toBe(true);
  });

  it('只有开启搜索内显示且状态可读时出现结果；区域隐藏不参与判断', () => {
    expect(bookmarkOptions('文档')).toHaveLength(1);
    expect(bookmarkOptions('文档', 'ready', { showInSearch: false })).toEqual([]);
    for (const status of ['disabled', 'permission-missing', 'unsupported', 'loading'] as const) {
      expect(bookmarkOptions('文档', status)).toEqual([]);
    }
    expect(bookmarkOptions('文档', 'error')).toEqual([]);
  });

  it('stale 时每条书签结果都标注上次读取', () => {
    const items = bookmarkOptions('工作', 'stale');
    expect(items.map(({ id }) => id)).toEqual(['bookmark-folder:work', 'bookmark:docs']);
    expect(items.every(({ detail }) => detail.startsWith('上次读取 · 浏览器书签 · '))).toBe(true);
  });

  it('自有结果不因书签关闭或不可用而消失', () => {
    const search = createDefaultSettings().search;
    const withIndex = (status: BookmarkSearchStatus) => buildSearchResults({ query: '本地', settings: search,
      context: CONTEXT, index: [{ id: 'own', kind: 'site', label: '本地站点', detail: '主页 · https://own.example.com',
        value: 'https://own.example.com', fields: [{ text: '本地站点', full: '本地站点', initials: '本地站点' }] }],
      indexStatus: 'ready', indexError: null,
      bookmarks: { showInSearch: false, index: buildBookmarkSearchIndex(projection([], status), PLAIN_SPELL) } });
    expect(withIndex('error').items.map(({ id }) => id)).toContain('site:own');
  });
});

describe('浏览器书签激活路由', () => {
  const targets = { search: 'current-tab', shortcut: 'new-tab' } as const;
  function ports() {
    return { copy: vi.fn(), open: vi.fn(), openFolder: vi.fn(), fill: vi.fn(), dismiss: vi.fn(), copied: vi.fn(),
      openBookmark: vi.fn(), openBookmarkFolder: vi.fn() };
  }
  const base = { id: 'bookmark:docs', label: '文档', detail: '浏览器书签 · 书签栏', value: 'https://docs.example.com' };
  const folderItem = { id: 'bookmark-folder:work', label: '工作', detail: '浏览器书签 · 书签栏 / 工作',
    value: 'work', bookmarkPath: ['bar', 'work'] };

  it('书签按节点委托上下文打开，不直接导航', async () => {
    const spy = ports();
    await executeSearchSuggestion({ item: { ...base, kind: 'bookmark', section: 'site', bookmarkNodeId: 'docs' },
      targets, ports: spy });
    expect(spy.openBookmark).toHaveBeenCalledWith('docs');
    expect(spy.open).not.toHaveBeenCalled();
    expect(spy.openBookmarkFolder).not.toHaveBeenCalled();
    expect(spy.dismiss).toHaveBeenCalled();
  });

  it('书签文件夹按投影内节点定位，不当作自有文件夹或网址', async () => {
    const spy = ports();
    await executeSearchSuggestion({ item: { ...folderItem, kind: 'bookmark-folder', section: 'folder' },
      targets, ports: spy });
    expect(spy.openBookmarkFolder).toHaveBeenCalledWith('work');
    expect(spy.openFolder).not.toHaveBeenCalled();
    expect(spy.openBookmark).not.toHaveBeenCalled();
  });

  it('不可激活的书签报错且不执行任何导航', async () => {
    const spy = ports();
    await expect(executeSearchSuggestion({ item: { ...base, kind: 'bookmark', section: 'site', value: '',
      bookmarkNodeId: 'docs', unavailable: true, activationError: '此书签没有可用地址，无法打开' }, targets, ports: spy }))
      .rejects.toThrow('此书签没有可用地址，无法打开');
    expect(spy.openBookmark).not.toHaveBeenCalled();
    expect(spy.open).not.toHaveBeenCalled();
    expect(spy.dismiss).not.toHaveBeenCalled();
  });

  it('上下文端口未接入时明确失败，不伪造打开成功', async () => {
    const spy = { copy: vi.fn(), open: vi.fn(), openFolder: vi.fn(), fill: vi.fn(), dismiss: vi.fn(), copied: vi.fn() };
    await expect(executeSearchSuggestion({ item: { ...base, kind: 'bookmark', section: 'site', bookmarkNodeId: 'docs' },
      targets, ports: spy })).rejects.toThrow('浏览器书签打开端口未接入');
    expect(spy.open).not.toHaveBeenCalled();
  });
});

describe('书签视图快照到搜索投影的结构适配', () => {
  function node(input: { readonly nodeId: string; readonly kind: BookmarkNodeView['kind'];
    readonly title: string; readonly url?: string | null; readonly path: readonly string[];
    readonly children?: readonly BookmarkNodeView[] }): BookmarkNodeView {
    return { nodeId: input.nodeId, kind: input.kind, title: input.title, url: input.url ?? null,
      path: input.path, children: input.children ?? [] };
  }
  const roots = [{ nodeId: 'bar', title: '书签栏', path: ['书签栏'], children: [
    node({ nodeId: 'work', kind: 'folder', title: '工作', path: ['书签栏', '工作'], children: [
      node({ nodeId: 'docs', kind: 'bookmark', title: '文档', url: 'https://docs.example.com', path: ['书签栏', '工作', '文档'] }),
      node({ nodeId: 'sep', kind: 'separator', title: '', path: ['书签栏', '工作', ''] }),
      node({ nodeId: 'blank', kind: 'bookmark', title: '', url: '', path: ['书签栏', '工作', ''] }),
    ] }),
    node({ nodeId: 'weird', kind: 'bookmark', title: '无协议', url: 'not-a-url', path: ['书签栏', '无协议'] }),
  ] }];

  function snapshot(input: { readonly status: BookmarkViewSnapshot['status']; readonly showInSearch?: boolean;
    readonly hiddenNodeIds?: readonly string[]; readonly permission?: BookmarkViewSnapshot['permission'];
    readonly roots?: BookmarkViewSnapshot['roots'] }) {
    return { status: input.status, permission: input.permission ?? 'granted', enabled: true, mode: 'region',
      showInSearch: input.showInSearch ?? true, regionVisible: false, roots: input.roots ?? roots,
      hiddenRules: [], hiddenNodeIds: input.hiddenNodeIds ?? [], ruleMatches: [], error: input.status === 'error' ? '读取失败' : null,
      actionError: null, readAt: 1, busy: false, folderRequest: null } satisfies BookmarkViewSnapshot;
  }

  it('隐藏节点与其后代不进入投影，分隔符保留但不索引，空标题与异常地址标记不可用', () => {
    const projection = bookmarkSearchProjection(snapshot({ status: 'ready', hiddenNodeIds: ['other'] }))!;
    expect(projection.status).toBe('ready');
    expect(projection.tree.map(({ id }) => id)).toEqual(['bar']);
    const work = projection.tree[0]!.children[0]!;
    expect(work.children.map(({ id, kind }) => `${kind}:${id}`))
      .toEqual(['bookmark:docs', 'separator:sep', 'bookmark:blank']);

    const items = buildBookmarkSearchIndex(projection, PLAIN_SPELL);
    expect(items.map(({ id }) => id)).toEqual(['bar', 'work', 'docs', 'blank', 'weird']);
    expect(items.find(({ id }) => id === 'blank')).toMatchObject({ label: '未命名书签', unavailable: true });
    expect(items.find(({ id }) => id === 'weird')).toMatchObject({ unavailable: true, value: '' });
  });

  it('隐藏的中间文件夹递归覆盖全部后代', () => {
    const projection = bookmarkSearchProjection(snapshot({ status: 'ready', hiddenNodeIds: ['work'] }))!;
    expect(projection.tree[0]!.children.map(({ id }) => id)).toEqual(['weird']);
  });

  it('隐藏的书签根连同全部后代一起离开投影与索引', () => {
    const projection = bookmarkSearchProjection(snapshot({ status: 'ready', hiddenNodeIds: ['bar'] }))!;
    expect(projection.tree).toEqual([]);
    expect(buildBookmarkSearchIndex(projection, PLAIN_SPELL)).toEqual([]);
    // 隐藏根不该被当成「空根」留在树里，否则空文件夹仍可被搜索到。
    const items = bookmarkResults('工作', 'ready', { tree: [folder('work', '工作', [bookmark('docs', '文档')])] });
    expect(items.items.some(({ kind }) => kind === 'bookmark' || kind === 'bookmark-folder')).toBe(true);
  });

  it('状态与搜索开关原样传递；不可读状态不产生结果', () => {
    const disabled = bookmarkSearchProjection(snapshot({ status: 'disabled', showInSearch: true }))!;
    expect(disabled.status).toBe('disabled');
    expect(buildBookmarkSearchIndex(disabled, PLAIN_SPELL)).toEqual([]);
    expect(bookmarkSearchProjection(snapshot({ status: 'permission-missing' }))!.status).toBe('permission-missing');
    const stale = bookmarkSearchProjection(snapshot({ status: 'stale' }))!;
    expect(stale.status).toBe('stale');
    expect(buildBookmarkSearchIndex(stale, PLAIN_SPELL).every(({ detail }) => detail.startsWith('上次读取 · '))).toBe(true);
    expect(bookmarkSearchProjection(snapshot({ status: 'ready', showInSearch: false }))!.status).toBe('ready');
  });
});

describe('书签上下文到搜索桥', () => {
  function link(input: { readonly nodeId: string; readonly title: string; readonly url: string | null }): BookmarkNodeView {
    return { nodeId: input.nodeId, kind: 'bookmark', title: input.title, url: input.url,
      path: ['书签栏', input.title], children: [] };
  }
  const roots = [{ nodeId: 'bar', title: '书签栏', path: ['书签栏'], children: [
    { nodeId: 'work', kind: 'folder' as const, title: '工作', url: null, path: ['书签栏', '工作'], children: [
      link({ nodeId: 'docs', title: '文档', url: 'https://docs.example.com' }),
      link({ nodeId: 'script', title: '旧脚本', url: 'javascript:alert(1)' }),
    ] },
  ] }];

  const context = (input: { readonly status: BookmarkViewSnapshot['status']; readonly showInSearch: boolean;
    readonly regionVisible: boolean; readonly enabled?: boolean; readonly permission?: BookmarkViewSnapshot['permission'];
    readonly readAt?: number | null; readonly roots?: BookmarkViewSnapshot['roots'];
    readonly hiddenNodeIds?: readonly string[] }) => ({
    snapshot: { status: input.status, permission: input.permission ?? 'granted' as const,
      enabled: input.enabled ?? true, mode: 'region' as const,
      showInSearch: input.showInSearch, regionVisible: input.regionVisible, roots: input.roots ?? roots,
      hiddenRules: [], hiddenNodeIds: input.hiddenNodeIds ?? [], ruleMatches: [], error: null, actionError: null,
      readAt: input.readAt ?? 1, busy: false, folderRequest: null } satisfies BookmarkViewSnapshot,
    requestEnable: vi.fn(), disable: vi.fn(), retry: vi.fn(), updateMode: vi.fn(), updateSearch: vi.fn(),
    setRegionVisible: vi.fn(), setHidden: vi.fn(), bindRule: vi.fn(), deleteRule: vi.fn(), clearCache: vi.fn(),
    openBookmark: vi.fn(), openFolder: vi.fn(),
  });

  it('区域隐藏但仍启用时继续提供搜索桥与结果', () => {
    const bridge = bookmarkSearchBridge(context({ status: 'ready', showInSearch: true, regionVisible: false }));
    expect(bridge).not.toBeNull();
    expect(bridge!.showInSearch).toBe(true);
    expect(bridge!.projection?.status).toBe('ready');
  });

  it('关闭功能、撤销权限或无匹配状态时同步返回空桥，不以旧结果兜底', () => {
    expect(bookmarkSearchBridge(context({ status: 'disabled', showInSearch: true, regionVisible: true, enabled: false }))).toBeNull();
    for (const status of ['permission-missing', 'unsupported', 'loading'] as const) {
      expect(bookmarkSearchBridge(context({ status, showInSearch: true, regionVisible: true }))).toBeNull();
    }
    // 权限被撤销时即使快照仍写着 ready，也不能产生结果。
    expect(bookmarkSearchBridge(context({ status: 'ready', showInSearch: true, regionVisible: true,
      permission: 'denied' }))).toBeNull();
    expect(bookmarkSearchBridge(context({ status: 'ready', showInSearch: true, regionVisible: true,
      enabled: false }))).toBeNull();
    expect(bookmarkSearchBridge(null)).toBeNull();
  });

  it('读取失败但权限有效时保留投影供 stale 使用；搜索开关关闭时不索引', () => {
    const failed = bookmarkSearchBridge(context({ status: 'error', showInSearch: true, regionVisible: true, readAt: 1234 }));
    expect(failed!.projection).toMatchObject({ status: 'error', readAt: 1234 });
    expect(buildBookmarkSearchIndex(failed!.projection ?? undefined, PLAIN_SPELL)).toEqual([]);
    const stale = bookmarkSearchBridge(context({ status: 'stale', showInSearch: true, regionVisible: true, readAt: 1234 }));
    expect(stale!.projection?.status).toBe('stale');
    const off = bookmarkSearchBridge(context({ status: 'ready', showInSearch: false, regionVisible: true }));
    expect(off!.showInSearch).toBe(false);
    // 关掉搜索开关时仍保留投影（重新打开无需重读），但结果生成器整体丢弃书签结果。
    expect(buildSearchResults({ query: '文档', settings: createDefaultSettings().search, context: CONTEXT,
      index: [], indexStatus: 'ready', indexError: null,
      bookmarks: { showInSearch: false, index: buildBookmarkSearchIndex(off!.projection ?? undefined, PLAIN_SPELL) } })
      .items.some(({ kind }) => kind === 'bookmark' || kind === 'bookmark-folder')).toBe(false);
  });

  it('打开链接按当前快照中的节点委托上下文，保留原始地址与全协议', () => {
    const value = context({ status: 'ready', showInSearch: true, regionVisible: true });
    const bridge = bookmarkSearchBridge(value)!;
    bridge.openBookmark!('docs');
    expect(value.openBookmark).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'docs',
      kind: 'bookmark', url: 'https://docs.example.com' }));
    bridge.openBookmark!('script');
    expect(value.openBookmark).toHaveBeenLastCalledWith(expect.objectContaining({ nodeId: 'script',
      url: 'javascript:alert(1)' }));
    expect(value.openFolder).not.toHaveBeenCalled();
  });

  it('文件夹结果按节点 ID 定位，不当作自有文件夹', () => {
    const value = context({ status: 'ready', showInSearch: true, regionVisible: true });
    const bridge = bookmarkSearchBridge(value)!;
    bridge.openBookmarkFolder!('work');
    expect(value.openFolder).toHaveBeenCalledWith('work');
    expect(value.openBookmark).not.toHaveBeenCalled();
  });

  it('节点已不在当前投影时明确失败，不猜测或回退到其他节点', () => {
    const value = context({ status: 'ready', showInSearch: true, regionVisible: true });
    const bridge = bookmarkSearchBridge(value)!;
    expect(() => bridge.openBookmark!('deleted')).toThrow('书签已不在当前列表');
    expect(() => bridge.openBookmarkFolder!('deleted')).toThrow('书签已不在当前列表');
    expect(value.openBookmark).not.toHaveBeenCalled();
    expect(value.openFolder).not.toHaveBeenCalled();
  });

  it('深度 5000 合法单链经桥投影、索引后可由查询命中尾部书签（递归会栈溢出）', () => {
    const DEPTH = 5000;
    // adapter 不读取 view.path（完整路径由标题重建），这里保持短路径以免 fixture 自己把内存耗尽。
    const path = ['书签栏'];
    let child: BookmarkNodeView = { nodeId: 'leaf', kind: 'bookmark', title: '深层链接',
      url: 'https://deep.example.com', path, children: [] };
    for (let level = DEPTH - 1; level >= 0; level -= 1) {
      child = { nodeId: `f${level}`, kind: 'folder', title: `F${level}`, url: null, path, children: [child] };
    }
    const deepRoots = [{ nodeId: 'bar', title: '书签栏', path, children: [child] }];
    const deepContext = context({ status: 'ready', showInSearch: true, regionVisible: true,
      roots: deepRoots });
    const bridge = bookmarkSearchBridge(deepContext)!;
    const items = buildBookmarkSearchIndex(bridge.projection ?? undefined, PLAIN_SPELL);
    expect(items).toHaveLength(DEPTH + 2);
    expect(items.slice(0, 3).map(({ id }) => id)).toEqual(['bar', 'f0', 'f1']);
    const leaf = items.at(-1)!;
    expect(leaf).toMatchObject({ id: 'leaf', kind: 'bookmark', label: '深层链接',
      value: 'https://deep.example.com', bookmarkNodeId: 'leaf' });
    expect(leaf.bookmarkPath).toHaveLength(DEPTH + 2);
    expect(leaf.detail).toBe(`浏览器书签 · ${['书签栏', ...Array.from({ length: DEPTH }, (_, level) => `F${level}`)]
      .join(' / ')}`);
    const found = buildSearchResults({ query: 'deep.example.com', settings: createDefaultSettings().search,
      context: CONTEXT, index: [], indexStatus: 'ready', indexError: null,
      bookmarks: { showInSearch: true, index: items } });
    expect(found.items).toContainEqual(expect.objectContaining({ id: 'bookmark:leaf', kind: 'bookmark',
      value: 'https://deep.example.com' }));
    // 打开委托仍按节点 ID 在深层快照里定位，不递归。
    bridge.openBookmark!('leaf');
    expect(deepContext.openBookmark).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'leaf',
      url: 'https://deep.example.com' }));
    // 隐藏深层文件夹仍递归覆盖其后代，且不丢前面的条目。
    const hiddenDeep = bookmarkSearchBridge(context({ status: 'ready', showInSearch: true,
      regionVisible: true, roots: deepRoots, hiddenNodeIds: ['f2499'] }))!;
    const hiddenItems = buildBookmarkSearchIndex(hiddenDeep.projection ?? undefined, PLAIN_SPELL);
    expect(hiddenItems).toHaveLength(2500);
    expect(hiddenItems.at(-1)!.id).toBe('f2498');
  });

  it('根结果按根节点 ID 定位，不误报「书签已不在当前列表」', () => {
    const value = context({ status: 'ready', showInSearch: true, regionVisible: true });
    const bridge = bookmarkSearchBridge(value)!;
    // 索引会为根生成 bookmark-folder 结果，激活必须定位到当前快照里的根，而不是抛缺失。
    expect(bridge.projection!.tree.map(({ id, kind }) => `${kind}:${id}`)).toEqual(['root:bar']);
    expect(() => bridge.openBookmarkFolder!('bar')).not.toThrow();
    expect(value.openFolder).toHaveBeenCalledWith('bar');
    expect(value.openBookmark).not.toHaveBeenCalled();
    // 根不是链接：拿根 ID 走打开链接必须失败，不能把根节点当书签委托出去。
    expect(() => bridge.openBookmark!('bar')).toThrow('书签已不在当前列表');
    expect(value.openBookmark).not.toHaveBeenCalled();
  });

  it('关闭或撤销后，渲染门控同步丢弃上一次投影，不等索引重建', () => {
    // 上一次可读状态留下的非空索引；桥变空后调用方只会传出 showInSearch: false。
    const staleIndex = buildBookmarkSearchIndex(
      projection([folder('work', '工作', [bookmark('docs', '文档')])]), PLAIN_SPELL);
    expect(staleIndex).not.toEqual([]);
    for (const input of [
      { status: 'disabled' as const, enabled: false },
      { status: 'permission-missing' as const, enabled: true },
      { status: 'ready' as const, enabled: true, permission: 'denied' as const },
    ]) {
      const bridge = bookmarkSearchBridge(context({ ...input, showInSearch: true, regionVisible: true }));
      expect(bridge).toBeNull();
      // 桥为空 → 渲染层传 false；旧索引仍在内存也不再产生书签结果。
      expect(buildSearchResults({ query: '文档', settings: createDefaultSettings().search, context: CONTEXT,
        index: [], indexStatus: 'ready', indexError: null,
        bookmarks: { showInSearch: bridge?.showInSearch === true, index: staleIndex } })
        .items.some(({ kind }) => kind === 'bookmark' || kind === 'bookmark-folder')).toBe(false);
    }
  });
});
