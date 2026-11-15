import { describe, expect, it } from 'vitest';

import {
  BOOKMARK_REGION_TITLE,
  bookmarkDisplayName,
  createBookmarkTreeIndex,
  isOpenableBookmark,
  isSearchableBookmark,
  normalizeBookmarkTree,
  parseNormalizedBookmarkTree,
  projectBookmarkTree,
  resolveHiddenRules,
  type BookmarkFolderProjection,
  type BookmarkRegionProjection,
  type BrowserBookmarkNode,
  type NormalizedBookmarkTree,
  type RawBookmarkNode,
} from '@/domain/browser-bookmarks';

function raw(overrides: RawBookmarkNode): RawBookmarkNode {
  return overrides;
}

/** Chrome 形态：单一内部虚拟根 '0'。 */
function chromeTree(children: readonly RawBookmarkNode[]): RawBookmarkNode[] {
  return [raw({ id: '0', title: '', type: 'folder', children: [...children] })];
}

function folder(id: string, title: string, children: readonly RawBookmarkNode[], parentId = '0'): RawBookmarkNode {
  return raw({ id, parentId, title, type: 'folder', children: [...children] });
}

function link(id: string, title: string, url: string | undefined, parentId = '0'): RawBookmarkNode {
  return raw({ id, parentId, title, ...(url === undefined ? {} : { url }) });
}

function collect(tree: NormalizedBookmarkTree): BrowserBookmarkNode[] {
  const nodes: BrowserBookmarkNode[] = [];
  const stack = [...tree.roots];
  while (stack.length > 0) {
    const node = stack.pop() as BrowserBookmarkNode;
    nodes.push(node);
    stack.push(...node.children);
  }
  return nodes;
}

/** 收窄投影联合类型：调用处显式要求某个模式，收窄失败即测试失败，不用 as any 掩盖。 */
function folderProjection(
  tree: NormalizedBookmarkTree,
  hidden?: ReadonlySet<string>,
): BookmarkFolderProjection {
  const projection = projectBookmarkTree(tree, hidden === undefined ? { mode: 'folder' } : { mode: 'folder', hidden });
  if (projection.mode !== 'folder') throw new Error('期望文件夹模式投影');
  return projection;
}

function regionProjection(
  tree: NormalizedBookmarkTree,
  hidden?: ReadonlySet<string>,
): BookmarkRegionProjection {
  const projection = projectBookmarkTree(tree, hidden === undefined ? { mode: 'region' } : { mode: 'region', hidden });
  if (projection.mode !== 'region') throw new Error('期望区域模式投影');
  return projection;
}

describe('normalizeBookmarkTree', () => {
  it('移除 Chrome 内部虚拟根并保留公开根的浏览器 id 与顺序', () => {
    const tree = normalizeBookmarkTree(chromeTree([
      folder('1', '书签栏', []),
      folder('2', '其他书签', []),
      folder('3', '移动设备书签', []),
    ]));

    expect(tree.roots.map((root) => [root.id, root.title, root.parentId])).toEqual([
      ['1', '书签栏', null],
      ['2', '其他书签', null],
      ['3', '移动设备书签', null],
    ]);
    expect(tree.nodeCount).toBe(3);
  });

  it('识别 Firefox 虚拟根 root________ 并移除', () => {
    const tree = normalizeBookmarkTree([raw({
      id: 'root________',
      title: '',
      type: 'folder',
      children: [
        raw({ id: 'toolbar_____', parentId: 'root________', title: '书签工具栏', type: 'folder', children: [] }),
      ],
    })]);

    expect(tree.roots.map((root) => root.id)).toEqual(['toolbar_____']);
  });

  it('单个空白标题的公开根原样保留，不凭标题推断为虚拟根', () => {
    const tree = normalizeBookmarkTree([raw({ id: 'user-root', title: '', type: 'folder', children: [] })]);

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]).toMatchObject({ id: 'user-root', title: '', parentId: null, kind: 'folder' });
    expect(bookmarkDisplayName(tree.roots[0] as BrowserBookmarkNode)).toBe('（无标题）');
    expect(folderProjection(tree).roots.map((root) => root.id)).toEqual(['user-root']);  });

  it('顺序取自浏览器 index，不按标题重排；重复项与重复地址全部保留', () => {
    const tree = normalizeBookmarkTree(chromeTree([
      raw({ id: 'b', parentId: '0', title: 'B', url: 'https://example.com/1', index: 1 }),
      raw({ id: 'a', parentId: '0', title: 'A', url: 'https://example.com/1', index: 0 }),
      raw({ id: 'c', parentId: '0', title: 'A', url: 'https://example.com/1', index: 2 }),
    ]));

    expect(tree.roots.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(tree.roots.map((node) => node.index)).toEqual([0, 1, 2]);
    expect(tree.linkCount).toBe(3);
    expect(tree.roots[1]?.url).toBe('https://example.com/1');
  });

  it('显式 type: folder 且缺 children 时仍是可进入的空文件夹', () => {
    const tree = normalizeBookmarkTree(chromeTree([
      raw({ id: 'empty', parentId: '0', title: '空文件夹', type: 'folder' }),
    ]));

    expect(tree.roots[0]).toMatchObject({ id: 'empty', kind: 'folder', isFolder: true, children: [] });
    expect(tree.folderCount).toBe(1);
    const projection = folderProjection(tree);
    expect(projection.roots[0]?.entries).toEqual([]);
    expect(projection.levels.get('empty')?.entries).toEqual([]);
  });

  it('缺失或畸形地址的节点仍可见，但标记为不可打开、不可搜索', () => {
    const tree = normalizeBookmarkTree(chromeTree([
      raw({ id: 'missing', parentId: '0', title: '缺地址' }),
      raw({ id: 'blank', parentId: '0', title: '', url: '   ' }),
      raw({ id: 'broken', parentId: '0', title: '坏地址', url: 'not a url' }),
      raw({ id: 'script', parentId: '0', title: '脚本', url: 'javascript:alert(1)' }),
    ]));

    expect(tree.roots).toHaveLength(4);
    expect(tree.roots.map((node) => node.url)).toEqual([null, '   ', 'not a url', 'javascript:alert(1)']);
    expect(tree.roots.map(isOpenableBookmark)).toEqual([false, false, false, true]);
    expect(tree.roots.map(isSearchableBookmark)).toEqual([false, false, false, true]);
    expect(bookmarkDisplayName(tree.roots[0] as BrowserBookmarkNode)).toBe('缺地址');
    expect(bookmarkDisplayName(tree.roots[1] as BrowserBookmarkNode)).toBe('   ');
  });

  it('Firefox 分隔符保留原位、计数正确且不参与搜索', () => {
    const tree = normalizeBookmarkTree([raw({
      id: 'menu________',
      title: '书签菜单',
      type: 'folder',
      children: [
        raw({ id: 'l1', parentId: 'menu________', title: '一', url: 'https://one.example/', index: 0 }),
        raw({ id: 's1', parentId: 'menu________', type: 'separator', index: 1 }),
        raw({ id: 'l2', parentId: 'menu________', title: '二', url: 'https://two.example/', index: 2 }),
      ],
    })]);

    const root = tree.roots[0] as BrowserBookmarkNode;
    expect(root.children.map((node) => node.kind)).toEqual(['bookmark', 'separator', 'bookmark']);
    expect(tree.separatorCount).toBe(1);
    expect(tree.linkCount).toBe(2);
    expect(root.children[1] && isSearchableBookmark(root.children[1])).toBe(false);
    expect(isSearchableBookmark(root.children[0] as BrowserBookmarkNode)).toBe(true);
  });

  it('对结构性非法树整次失败，不返回部分结果', () => {
    expect(() => normalizeBookmarkTree([])).toThrowError(/顶层为空/);
    expect(() => normalizeBookmarkTree({})).toThrowError(/顶层不是数组/);
    expect(() => normalizeBookmarkTree(chromeTree([raw({ parentId: '0', title: '无 id' })])))
      .toThrowError(/缺少 id/);
    expect(() => normalizeBookmarkTree(chromeTree([
      link('dup', 'A', 'https://a.example/'),
      link('dup', 'B', 'https://b.example/'),
    ]))).toThrowError(/id 重复/);
    expect(() => normalizeBookmarkTree(chromeTree([
      raw({ id: 'child', parentId: 'missing', title: '孤儿', url: 'https://a.example/' }),
    ]))).toThrowError(/parentId/);
    expect(() => normalizeBookmarkTree(chromeTree([
      raw({ id: 'bad', parentId: '0', title: '坏 children', type: 'folder', children: 'x' as never }),
    ]))).toThrowError(/children 不是数组/);
  });

  it('父子成环时终止而不是无限循环', () => {
    const cyclic: Record<string, unknown> = { id: 'a', parentId: '0', title: 'A', type: 'folder', children: [] };
    cyclic.children = [cyclic];
    expect(() => normalizeBookmarkTree(chromeTree([cyclic as RawBookmarkNode]))).toThrowError(/成环/);
  });

  it('深层合法树不因递归而消失（无深度上限）', () => {
    const depth = 2000;
    const leaf: RawBookmarkNode = raw({
      id: 'leaf',
      parentId: `f${depth}`,
      title: 'leaf',
      url: 'https://deep.example/',
    });
    let node: RawBookmarkNode = leaf;
    for (let level = depth; level >= 1; level -= 1) {
      const children: RawBookmarkNode[] = [node];
      node = raw({
        id: `f${level}`,
        parentId: level === 1 ? '0' : `f${level - 1}`,
        title: `层${level}`,
        type: 'folder',
        children,
      });
    }
    const tree = normalizeBookmarkTree(chromeTree([node]));
    expect(tree.nodeCount).toBe(depth + 1);
    expect(tree.folderCount).toBe(depth);

    const projection = folderProjection(tree);
    expect(projection.levels.size).toBe(depth);
    expect(projection.levels.get(`f${depth}`)?.entries[0]?.id).toBe('leaf');
    const region = regionProjection(tree);
    expect(region.groups).toHaveLength(depth);
    expect(region.groups.at(-1)?.path).toHaveLength(depth);
  });
});

describe('projectBookmarkTree', () => {
  const tree = normalizeBookmarkTree(chromeTree([
    folder('1', '书签栏', [
      link('a', '主页', 'https://a.example/', '1'),
      folder('f1', '工作', [
        link('b', '内网', 'https://b.example/', 'f1'),
        folder('f2', '归档', [link('c', 'C', 'https://c.example/', 'f2')], 'f1'),
      ], '1'),
      link('d', '后置', 'https://d.example/', '1'),
    ]),
    folder('2', '其他书签', [link('e', 'E', 'https://e.example/', '2')]),
  ]));

  it('区域模式：全部根、固定标题，根直接链接归入未分类且不改变条目顺序', () => {
    const projection = regionProjection(tree);
    expect(projection.title).toBe(BOOKMARK_REGION_TITLE);
    expect(projection.groups.map((group) => [group.rootId, group.folderId, group.title, group.path])).toEqual([
      ['1', null, '未分类', ['书签栏']],
      ['1', 'f1', '工作', ['书签栏', '工作']],
      ['1', 'f2', '归档', ['书签栏', '工作', '归档']],
      ['2', null, '未分类', ['其他书签']],
    ]);
    // 根分组条目保持浏览器交错顺序：链接 → 文件夹 → 链接
    expect(projection.groups[0]?.entries.map((entry) => entry.id)).toEqual(['a', 'f1', 'd']);
    expect(projection.groups[0]?.rootTitle).toBe('书签栏');
  });

  it('文件夹模式：顶层是浏览器根，逐层只含直接子项', () => {
    const projection = folderProjection(tree);
    expect(projection.roots.map((level) => level.id)).toEqual(['1', '2']);
    expect(projection.roots[0]?.entries.map((entry) => entry.id)).toEqual(['a', 'f1', 'd']);
    expect(projection.levels.get('f1')?.entries.map((entry) => entry.id)).toEqual(['b', 'f2']);
    expect(projection.levels.get('f2')?.path).toEqual(['书签栏', '工作', '归档']);
  });

  it('隐藏根时其全部后代从投影与计数中消失，其他根不受影响', () => {
    const projection = regionProjection(tree, new Set(['1']));
    expect(projection.groups.map((group) => group.rootId)).toEqual(['2']);
    expect(projection.nodeCount).toBe(2);
    expect(projection.linkCount).toBe(1);
  });

  it('隐藏内层文件夹只移除该子树，父级其他条目顺序不变', () => {
    const projection = regionProjection(tree, new Set(['f1']));
    expect(projection.groups.map((group) => group.id)).toEqual(['root:1', 'root:2']);
    expect(projection.groups[0]?.entries.map((entry) => entry.id)).toEqual(['a', 'd']);
  });
});

describe('resolveHiddenRules', () => {
  const tree = normalizeBookmarkTree(chromeTree([
    folder('1', '书签栏', [
      folder('f1', '工作', [folder('f2', '同名', [], 'f1')], '1'),
      folder('f9', '工作', [folder('f10', '同名', [], 'f9')], '1'),
    ]),
    folder('2', '其他书签', [folder('f3', 'Archive', [folder('f4', '子项', [], 'f3')], '2')]),
  ]));

  const baseRule = {
    targetId: 'f1',
    path: ['书签栏', '工作'],
    kind: 'folder' as const,
    hidden: true,
    updatedAt: 1,
  };

  it('ID 优先命中，即使路径指向别处', () => {
    const resolution = resolveHiddenRules(tree, [{ ...baseRule, ruleId: 'r1', path: ['其他书签'] }]);
    expect(resolution.matched).toEqual([
      { rule: expect.objectContaining({ ruleId: 'r1' }), nodeId: 'f1', matchedBy: 'id', candidates: ['f1'] },
    ]);
    expect([...resolution.hiddenNodeIds]).toEqual(['f1']);
    expect(resolution.pending).toEqual([]);
  });

  it('ID 不存在时按规范化完整路径唯一回退，大小写与空白折叠', () => {
    const resolution = resolveHiddenRules(tree, [{
      ...baseRule,
      ruleId: 'r2',
      targetId: 'stale-id',
      path: ['  其他书签 ', ' ARCHIVE '],
    }]);
    expect(resolution.matched[0]).toMatchObject({ nodeId: 'f3', matchedBy: 'path' });
  });

  it('同名同路径不唯一时标记 ambiguous 且不隐藏任何内容', () => {
    const resolution = resolveHiddenRules(tree, [{
      ...baseRule,
      ruleId: 'r3',
      targetId: 'gone',
      path: ['书签栏', '工作'],
    }]);
    expect(resolution.pending).toEqual([
      { rule: expect.objectContaining({ ruleId: 'r3', hidden: true }), status: 'ambiguous', candidates: ['f1', 'f9'] },
    ]);
    expect(resolution.hiddenNodeIds.size).toBe(0);
    expect(resolution.matched).toEqual([]);
  });

  it('无匹配标记 unmatched 并保留规则，不写“已取消隐藏”', () => {
    const rule = { ...baseRule, ruleId: 'r4', targetId: 'gone', path: ['不存在'] };
    const resolution = resolveHiddenRules(tree, [rule]);
    expect(resolution.pending).toEqual([{ rule, status: 'unmatched', candidates: [] }]);
    expect(resolution.hiddenNodeIds.size).toBe(0);
  });

  it('hidden: false 保留规则但从不隐藏；单条链接不会被当成合法目标', () => {
    const resolution = resolveHiddenRules(tree, [
      { ...baseRule, ruleId: 'r5', hidden: false },
      { ...baseRule, ruleId: 'r6', targetId: 'f2', kind: 'root' },
    ]);
    expect(resolution.hiddenNodeIds.size).toBe(0);
    expect(resolution.matched.map((match) => match.rule.ruleId)).toEqual(['r5']);
    expect(resolution.pending.map((entry) => [entry.rule.ruleId, entry.status])).toEqual([['r6', 'unmatched']]);
  });

  it('隐藏根递归覆盖全部后代，可用于投影', () => {
    const resolution = resolveHiddenRules(tree, [{ ...baseRule, ruleId: 'r7', targetId: '1', kind: 'root', path: ['书签栏'] }]);
    const projection = regionProjection(tree, resolution.hiddenNodeIds);
    expect(new Set(projection.groups.map((group) => group.rootId))).toEqual(new Set(['2']));
  });

  it('任意顺序输入都按 ruleId 排序，结果稳定', () => {
    const resolution = resolveHiddenRules(tree, [
      { ...baseRule, ruleId: 'b' },
      { ...baseRule, ruleId: 'a', hidden: false },
    ]);
    expect(resolution.matched.map((match) => match.rule.ruleId)).toEqual(['a', 'b']);
  });

  /** 统计领域层对节点 id / path 的真实读取次数：空规则与纯 ID 命中都不该碰路径。 */
  function instrumentReads(current: NormalizedBookmarkTree): {
    readonly idReads: () => number;
    readonly pathReads: () => number;
  } {
    let idReads = 0;
    let pathReads = 0;
    const stack = [...current.roots];
    while (stack.length > 0) {
      const node = stack.pop() as BrowserBookmarkNode;
      const id = node.id;
      const path = node.path;
      Object.defineProperty(node, 'id', {
        configurable: true,
        get() { idReads += 1; return id; },
      });
      Object.defineProperty(node, 'path', {
        configurable: true,
        get() { pathReads += 1; return path; },
      });
      stack.push(...node.children);
    }
    return { idReads: () => idReads, pathReads: () => pathReads };
  }

  it('空规则直接返回空结果，不建全树 ID 索引也不建路径索引', () => {
    const reads = instrumentReads(tree);
    const resolution = resolveHiddenRules(tree, []);
    expect(resolution.hiddenNodeIds.size).toBe(0);
    expect(resolution.matched).toEqual([]);
    expect(resolution.pending).toEqual([]);
    expect(reads.idReads()).toBe(0);
    expect(reads.pathReads()).toBe(0);
  });

  it('规则全部按 ID 命中或类型非法时不读取任何路径', () => {
    const reads = instrumentReads(tree);
    const resolution = resolveHiddenRules(tree, [
      { ...baseRule, ruleId: 'a' },
      { ...baseRule, ruleId: 'b', targetId: 'f3', path: ['其他书签', 'Archive'] },
      { ...baseRule, ruleId: 'c', kind: 'link' as never },
    ]);
    expect(resolution.matched.map((match) => [match.rule.ruleId, match.nodeId, match.matchedBy])).toEqual([
      ['a', 'f1', 'id'],
      ['b', 'f3', 'id'],
    ]);
    expect(resolution.pending.map((entry) => [entry.rule.ruleId, entry.status])).toEqual([['c', 'unmatched']]);
    // 没有规则需要路径回退：不读任何 path，也就不做 NFKC/trim/lower 归一化。
    expect(reads.pathReads()).toBe(0);
    expect(reads.idReads()).toBeGreaterThan(0);
  });

  it('只有真正需要路径回退时才惰性建立路径索引，且多条规则共用一次', () => {
    const reads = instrumentReads(tree);
    const resolution = resolveHiddenRules(tree, [
      { ...baseRule, ruleId: 'a', targetId: 'gone', path: [' 其他书签 ', 'ARCHIVE '] },
      { ...baseRule, ruleId: 'b', targetId: 'also-gone', path: ['书签栏', '工作'] },
    ]);
    // 每个文件夹的 path 只被读取一次：索引建一次，顺序与候选不变。
    expect(reads.pathReads()).toBe(tree.folderCount);
    expect(resolution.matched.map((match) => [match.rule.ruleId, match.nodeId, match.matchedBy])).toEqual([
      ['a', 'f3', 'path'],
    ]);
    expect(resolution.pending).toEqual([
      { rule: expect.objectContaining({ ruleId: 'b' }), status: 'ambiguous', candidates: ['f1', 'f9'] },
    ]);
    expect([...resolution.hiddenNodeIds]).toEqual(['f3']);
  });

  it('惰性路径索引不改变 ID 优先：同一棵树既有 ID 命中和路径回退也正确', () => {
    const resolution = resolveHiddenRules(tree, [
      { ...baseRule, ruleId: 'a', targetId: 'gone', path: ['其他书签', 'Archive'] },
      { ...baseRule, ruleId: 'b' },
    ]);
    expect(resolution.matched.map((match) => [match.rule.ruleId, match.nodeId, match.matchedBy])).toEqual([
      ['a', 'f3', 'path'],
      ['b', 'f1', 'id'],
    ]);
  });

  it('深层合法树上的空规则不触碰整树：5000 层也只返回空结果', () => {
    const depth = 5000;
    let node: RawBookmarkNode = raw({ id: `n${depth}`, parentId: `n${depth - 1}`, title: '末叶', url: 'https://deep.example/' });
    for (let level = depth - 1; level >= 0; level -= 1) {
      const id = `n${level}`;
      node = raw({
        id,
        parentId: level === 0 ? '0' : `n${level - 1}`,
        title: `层${level}`,
        type: 'folder',
        children: [{ id: `${id}-empty`, parentId: id, title: '空层', type: 'folder' }, node],
      });
    }
    const deep = normalizeBookmarkTree(chromeTree([node]));
    const reads = instrumentReads(deep);
    const resolution = resolveHiddenRules(deep, []);
    expect(resolution.hiddenNodeIds.size).toBe(0);
    expect(resolution.matched).toEqual([]);
    expect(resolution.pending).toEqual([]);
    expect(reads.idReads()).toBe(0);
    expect(reads.pathReads()).toBe(0);
  });
});

describe('parseNormalizedBookmarkTree', () => {
  const tree = normalizeBookmarkTree([raw({
    id: 'menu________',
    title: '书签菜单',
    type: 'folder',
    children: [
      raw({ id: 'l1', parentId: 'menu________', title: '一', url: 'https://one.example/' }),
      raw({ id: 's1', parentId: 'menu________', type: 'separator' }),
    ],
  })]);

  it('往返保留分隔符计数与结构', () => {
    const parsed = parseNormalizedBookmarkTree(JSON.parse(JSON.stringify(tree)));
    expect(parsed.separatorCount).toBe(1);
    expect(parsed.roots[0]?.children.map((node) => node.kind)).toEqual(['bookmark', 'separator']);
    expect(parsed.nodeCount).toBe(tree.nodeCount);
  });

  it('拒绝与祖先标题不一致的缓存路径，避免隐藏规则错误绑定', () => {
    type CorruptedNode = { path: string[]; children: CorruptedNode[] };
    const corrupted = JSON.parse(JSON.stringify(tree)) as { roots: CorruptedNode[] };
    corrupted.roots[0]!.children[0]!.path = ['别的根', '一'];
    expect(() => parseNormalizedBookmarkTree(corrupted)).toThrowError(/路径与祖先标题不一致/);
  });

  it('逐段校验路径：深层中间段被改写也会失败', () => {
    const nested = normalizeBookmarkTree(chromeTree([
      folder('1', '书签栏', [
        folder('f1', '工作', [
          folder('f2', '归档', [link('c', 'C', 'https://c.example/', 'f2')], 'f1'),
        ], '1'),
      ]),
    ]));
    type CorruptedNode = { path: string[]; children: CorruptedNode[] };
    const copy = () => JSON.parse(JSON.stringify(nested)) as { roots: CorruptedNode[] };
    const corrupt = (target: 'root' | 'middle' | 'leaf') => {
      const next = copy();
      const root = next.roots[0]!;
      const middle = root.children[0]!;
      const leaf = middle.children[0]!;
      if (target === 'root') root.path = ['错根'];
      if (target === 'middle') middle.path = ['书签栏', '错层'];
      if (target === 'leaf') leaf.path = ['书签栏', '工作', '错叶'];
      return next;
    };
    expect(() => parseNormalizedBookmarkTree(corrupt('root'))).toThrowError(/路径与祖先标题不一致/);
    expect(() => parseNormalizedBookmarkTree(corrupt('middle'))).toThrowError(/路径与祖先标题不一致/);
    expect(() => parseNormalizedBookmarkTree(corrupt('leaf'))).toThrowError(/路径与祖先标题不一致/);
    // 未改动时逐段一致，能正常读回并保留三段路径。
    const parsed = parseNormalizedBookmarkTree(copy());
    expect(parsed.roots[0]?.children[0]?.children[0]?.path).toEqual(['书签栏', '工作', '归档']);
  });

  it('拒绝重复 id、未知类型与错误父引用', () => {
    type MutableNode = { id: string; kind?: string; children?: MutableNode[] };
    const duplicate = JSON.parse(JSON.stringify(tree)) as { roots: MutableNode[] };
    const duplicateRoot = duplicate.roots[0]!;
    duplicateRoot.children = undefined;
    duplicateRoot.id = 'l1';
    expect(() => parseNormalizedBookmarkTree(duplicate)).toThrowError(/id 重复|子节点不是数组/);

    const unknown = JSON.parse(JSON.stringify(tree)) as { roots: MutableNode[] };
    unknown.roots[0]!.kind = 'mystery';
    expect(() => parseNormalizedBookmarkTree(unknown)).toThrowError(/类型未知/);
  });
});

describe('createBookmarkTreeIndex', () => {
  it('索引所有层级的节点', () => {
    const tree = normalizeBookmarkTree(chromeTree([
      folder('1', '书签栏', [folder('f1', '工作', [link('b', 'B', 'https://b.example/', 'f1')], '1')]),
    ]));
    const index = createBookmarkTreeIndex(tree);
    expect([...index.byId.keys()].sort()).toEqual(['1', 'b', 'f1']);
  });
});
