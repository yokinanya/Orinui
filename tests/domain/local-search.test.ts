import { describe, expect, it, vi } from 'vitest';
import { pinyin } from 'pinyin-pro';
import { buildLocalSearchIndex, searchLocalIndex, type BookmarkSearchNode,
  type BookmarkSearchProjection, type BookmarkSearchStatus,
  type TransliterateSearchText } from '@/domain/local-search';
import type { Folder } from '@/domain/folder';
import { shortcutDisplayName } from '@/domain/shortcut';
import type { Shortcut } from '@/domain/shortcut';

function site(input: { readonly id: string; readonly title: string; readonly order: number; readonly folderId?: string }): Shortcut {
  return { ...input, folderId: input.folderId ?? null, icon: { kind: 'letter' }, iconSourceUrl: null,
    url: `https://${input.id}.example.com` };
}

function folder(id: string, name: string, parentId: string | null = null, order = 0): Folder {
  return { id, parentId, name, order };
}

const spell = (value: string) => ({ full: pinyin(value, { toneType: 'none', type: 'array' }).join(''),
  initials: pinyin(value, { pattern: 'first', type: 'array' }).join('') });

const plainSpell = (value: string) => ({ full: value, initials: value });

/** 记录每次转写入参，用于断言同一次构建内不重复转写同一原始字符串。 */
function countingSpell() {
  const calls: string[] = [];
  return { calls, transliterate: (value: string) => { calls.push(value); return spell(value); } };
}

function index() {
  return buildLocalSearchIndex({ folders: [folder('folder', '开发资料')],
    shortcuts: [site({ id: 'baidu', title: '百度', order: 1 }), site({ id: 'inside', title: '工具网站', folderId: 'folder', order: 0 }),
      site({ id: 'exact', title: 'bd', order: 3 }), site({ id: 'prefix', title: 'bd tools', order: 2 }),
      site({ id: 'contains', title: 'my bd website', order: 0 })],
    transliterate: spell });
}

function bookmark(input: { readonly id: string; readonly title: string; readonly url?: string | null;
  readonly unusable?: boolean }): BookmarkSearchNode {
  return { id: input.id, parentId: 'bar', index: 0, title: input.title,
    url: input.url === undefined ? `https://${input.id}.example.com` : input.url,
    kind: 'bookmark', unusable: input.unusable ?? false, children: [] };
}

function bookmarkFolder(input: { readonly id: string; readonly title: string; readonly kind?: 'root' | 'folder';
  readonly parentId?: string | null; readonly children?: readonly BookmarkSearchNode[];
  readonly unusable?: boolean }): BookmarkSearchNode {
  return { id: input.id, parentId: input.parentId ?? null, index: 0, title: input.title, url: null,
    kind: input.kind ?? 'folder', unusable: input.unusable ?? false, children: input.children ?? [] };
}

function separator(id: string): BookmarkSearchNode {
  return { id, parentId: 'bar', index: 0, title: '', url: null, kind: 'separator', unusable: false, children: [] };
}

/** 迭代构造合法单链（root → f0…f(depth-1) → leaf），不递归、不序列化整棵树。 */
function deepChain(depth: number): BookmarkSearchNode {
  let child: BookmarkSearchNode = { id: 'leaf', parentId: depth === 0 ? 'bar' : `f${depth - 1}`, index: 0,
    title: '深层链接', url: 'https://deep.example.com', kind: 'bookmark', unusable: false, children: [] };
  for (let level = depth - 1; level >= 0; level -= 1) {
    child = { id: `f${level}`, parentId: level === 0 ? 'bar' : `f${level - 1}`, index: 0,
      title: `F${level}`, url: null, kind: 'folder', unusable: false, children: [child] };
  }
  return { id: 'bar', parentId: null, index: 0, title: '书签栏', url: null, kind: 'root',
    unusable: false, children: [child] };
}

function projection(tree: readonly BookmarkSearchNode[], status: BookmarkSearchStatus = 'ready'): BookmarkSearchProjection {
  return { tree, status, readAt: status === 'ready' ? 1 : null, error: status === 'error' ? '读取失败' : null };
}

function bookmarkIndex(tree: readonly BookmarkSearchNode[], status: BookmarkSearchStatus = 'ready') {
  return buildLocalSearchIndex({ folders: [], shortcuts: [], transliterate: plainSpell, bookmarks: projection(tree, status) });
}

function bookmarkIndexWith(tree: readonly BookmarkSearchNode[], transliterate: TransliterateSearchText) {
  return buildLocalSearchIndex({ folders: [], shortcuts: [], transliterate, bookmarks: projection(tree) });
}

const ALL_SOURCES = { showSites: true, showFolders: true, showBookmarks: true };

function ids(items: ReturnType<typeof searchLocalIndex>): string[] {
  return items.map(({ id }) => id);
}

describe('本地搜索索引', () => {
  it('原文匹配在全拼及首拼之前，相同分数保持用户顺序', () => {
    const result = searchLocalIndex({ index: index(), query: 'bd', sources: ALL_SOURCES });
    expect(result.map(({ id }) => id)).toEqual(['exact', 'prefix', 'contains', 'baidu']);
  });

  it('支持全拼、首拼、文件夹名和多词原文', () => {
    expect(searchLocalIndex({ index: index(), query: 'baidu', sources: ALL_SOURCES }).map(({ id }) => id)).toEqual(['baidu']);
    expect(searchLocalIndex({ index: index(), query: 'kfzl', sources: ALL_SOURCES }).map(({ id }) => id))
      .toEqual(['inside', 'folder']);
    expect(searchLocalIndex({ index: index(), query: 'bd tools', sources: ALL_SOURCES }).map(({ id }) => id)).toEqual(['prefix']);
  });

  it('网站与文件夹来源可独立关闭，不改变原索引', () => {
    const items = index();
    const snapshot = structuredClone(items);
    expect(searchLocalIndex({ index: items, query: '开发', sources: { showSites: false, showFolders: true, showBookmarks: true } })
      .map(({ id }) => id)).toEqual(['folder']);
    expect(searchLocalIndex({ index: items, query: '开发', sources: { showSites: true, showFolders: false, showBookmarks: true } })
      .map(({ id }) => id)).toEqual(['inside']);
    expect(items).toEqual(snapshot);
  });

  it('不会索引已不存在文件夹中的网站，也不匹配空查询', () => {
    const items = buildLocalSearchIndex({ shortcuts: [site({ id: 'orphan', title: 'orphan', order: 0, folderId: 'deleted' })],
      folders: [], transliterate: (value) => ({ full: value, initials: value }) });
    expect(items).toEqual([]);
    expect(searchLocalIndex({ index: index(), query: ' ', sources: ALL_SOURCES })).toEqual([]);
  });

  it('同分时保持传入的当前顺序，不混用不同容器内的 order', () => {
    const items = buildLocalSearchIndex({ folders: [],
      shortcuts: [site({ id: 'first', title: 'tools A', order: 8 }), site({ id: 'second', title: 'tools B', order: 0 })],
      transliterate: (value) => ({ full: value, initials: value }) });
    expect(searchLocalIndex({ index: items, query: 'tools', sources: ALL_SOURCES }).map(({ id }) => id))
      .toEqual(['first', 'second']);
  });

  it('网站与文件夹详情显示完整父路径，嵌套层名称可搜索', () => {
    const folders = [folder('dev', '开发资料'), folder('fe', '前端', 'dev')];
    const items = buildLocalSearchIndex({ folders,
      shortcuts: [site({ id: 'inside', title: '工具网站', order: 0, folderId: 'fe' })], transliterate: plainSpell });
    expect(items.find(({ id }) => id === 'inside')!.detail)
      .toBe('主页 / 开发资料 / 前端 · https://inside.example.com');
    expect(items.find(({ id }) => id === 'dev')!.detail).toBe('本地文件夹 · 主页 / 开发资料');
    expect(items.find(({ id }) => id === 'fe')!.detail).toBe('本地文件夹 · 主页 / 开发资料 / 前端');
    expect(ids(searchLocalIndex({ index: items, query: '前端', sources: ALL_SOURCES }))).toEqual(['inside', 'fe']);
    expect(ids(searchLocalIndex({ index: items, query: '开发', sources: ALL_SOURCES }))).toEqual(['inside', 'dev', 'fe']);
  });

  it('父引用缺失时只显示可确定的一段路径，不伪造层级', () => {
    const items = buildLocalSearchIndex({ folders: [folder('fe', '前端', 'missing')], shortcuts: [], transliterate: plainSpell });
    expect(items[0]!.detail).toBe('本地文件夹 · 主页 / 前端');
  });
});

describe('浏览器书签搜索索引', () => {
  it('索引完整路径、来源、根与空文件夹，分隔符不进入索引', () => {
    const tree = [bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [
      bookmarkFolder({ id: 'work', title: '工作', parentId: 'bar' }),
      bookmark({ id: 'docs', title: '文档', url: 'https://docs.example.com' }),
      separator('sep'),
    ] })];
    const items = bookmarkIndex(tree);
    expect(items.map(({ kind, id }) => `${kind}:${id}`))
      .toEqual(['bookmark-folder:bar', 'bookmark-folder:work', 'bookmark:docs']);
    expect(items[0]!.bookmarkNodeId).toBe('bar');
    expect(items[1]!.bookmarkNodeId).toBe('work');
    expect(items[2]!.bookmarkNodeId).toBe('docs');
    expect(items[0]!.detail).toBe('浏览器书签 · 书签栏');
    expect(items[1]!.detail).toBe('浏览器书签 · 书签栏 / 工作');
    expect(items[2]!.detail).toBe('浏览器书签 · 书签栏');
    expect(ids(searchLocalIndex({ index: items, query: '书签栏', sources: ALL_SOURCES })))
      .toEqual(['bar', 'work', 'docs']);
    expect(ids(searchLocalIndex({ index: items, query: '文档', sources: ALL_SOURCES }))).toEqual(['docs']);
  });

  it('重复书签各自独立，空地址与不可用节点只索引标题', () => {
    const tree = [bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [
      bookmark({ id: 'dup1', title: '文档', url: 'https://docs.example.com' }),
      bookmark({ id: 'dup2', title: '文档', url: 'https://docs.example.com' }),
      bookmark({ id: 'empty', title: '坏书签', url: null }),
      bookmark({ id: 'bad', title: '坏地址', url: 'https://bad.example.com', unusable: true }),
    ] })];
    const items = bookmarkIndex(tree);
    expect(items.filter(({ kind }) => kind === 'bookmark').map(({ id }) => id))
      .toEqual(['dup1', 'dup2', 'empty', 'bad']);
    expect(ids(searchLocalIndex({ index: items, query: 'docs.example.com', sources: ALL_SOURCES })))
      .toEqual(['dup1', 'dup2']);
    expect(ids(searchLocalIndex({ index: items, query: '坏书签', sources: ALL_SOURCES }))).toEqual(['empty']);
    expect(items.find(({ id }) => id === 'empty')).toMatchObject({ unavailable: true, value: '' });
    expect(items.find(({ id }) => id === 'bad')).toMatchObject({ unavailable: true, value: '' });
    expect(searchLocalIndex({ index: items, query: 'bad.example.com', sources: ALL_SOURCES })).toEqual([]);
  });

  it('仅 ready 与 stale 产生书签结果，stale 每条标注上次读取', () => {
    const tree = [bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [bookmark({ id: 'docs', title: '文档' })] })];
    for (const status of ['disabled', 'permission-missing', 'unsupported', 'error', 'loading'] as const) {
      const items = buildLocalSearchIndex({ folders: [], shortcuts: [], transliterate: plainSpell,
        bookmarks: projection(tree, status) });
      expect(items.filter(({ kind }) => kind.startsWith('bookmark'))).toEqual([]);
    }
    const stale = buildLocalSearchIndex({ folders: [], shortcuts: [site({ id: 'own', title: '网站', order: 0 })],
      transliterate: plainSpell, bookmarks: projection(tree, 'stale') });
    for (const item of stale.filter(({ kind }) => kind.startsWith('bookmark'))) {
      expect(item.detail.startsWith('上次读取 · ')).toBe(true);
    }
    expect(stale.find(({ id }) => id === 'own')!.detail.startsWith('上次读取')).toBe(false);
    expect(bookmarkIndex(tree).every(({ detail }) => !detail.startsWith('上次读取'))).toBe(true);
  });

  it('只索引传入的投影，隐藏文件夹的后代不会泄漏', () => {
    const visible = bookmark({ id: 'ok', title: '公开', url: 'https://ok.example.com' });
    const projected = [bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [visible] })];
    const items = bookmarkIndex(projected);
    expect(items.map(({ id }) => id)).toEqual(['bar', 'ok']);
    expect(searchLocalIndex({ index: items, query: '隐私', sources: ALL_SOURCES })).toEqual([]);
    expect(searchLocalIndex({ index: items, query: 'secret', sources: ALL_SOURCES })).toEqual([]);
  });

  it('关闭书签来源后不显示书签结果，也不影响自有结果', () => {
    const items = bookmarkIndex([bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root',
      children: [bookmark({ id: 'docs', title: '文档' })] })]);
    expect(ids(searchLocalIndex({ index: items, query: '文档', sources: { showSites: true, showFolders: true, showBookmarks: false } })))
      .toEqual([]);
    expect(ids(searchLocalIndex({ index: items, query: '书签栏', sources: { showSites: true, showFolders: true } })))
      .toEqual([]);
  });

  it('显式栈遍历保持 DFS 先序：父在前、深度优先、重复项各自保留，空文件夹保留而分隔符跳过', () => {
    const tree = [bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [
      bookmarkFolder({ id: 'a', title: 'A', children: [
        bookmark({ id: 'a1', title: '甲' }),
        bookmarkFolder({ id: 'a-empty', title: '空' }),
      ] }),
      separator('s'),
      bookmark({ id: 'b1', title: '甲' }),
      bookmark({ id: 'b2', title: '甲' }),
    ] })];
    expect(bookmarkIndex(tree).map(({ id }) => id)).toEqual(['bar', 'a', 'a1', 'a-empty', 'b1', 'b2']);
  });

  it('深度 5000 单链全量索引，完整路径可检索（递归会栈溢出）', () => {
    const DEPTH = 5000;
    const items = bookmarkIndex([deepChain(DEPTH)]);
    expect(items).toHaveLength(DEPTH + 2);
    const leaf = items.at(-1)!;
    expect(leaf).toMatchObject({ id: 'leaf', kind: 'bookmark', value: 'https://deep.example.com' });
    expect(leaf.bookmarkPath).toHaveLength(DEPTH + 2);
    expect(leaf.detail).toBe(`浏览器书签 · ${['书签栏', ...Array.from({ length: DEPTH }, (_, level) => `F${level}`)]
      .join(' / ')}`);
    expect(ids(searchLocalIndex({ index: items, query: 'deep.example.com', sources: ALL_SOURCES }))).toEqual(['leaf']);
  });

  it('深层单链构建不逐层重建完整路径数组，也不逐层重复 join 完整路径', () => {
    const DEPTH = 60;
    // 口径：只统计构建窗口内 Array.prototype.join 的调用次数。旧实现每层各 join 一次
    // （祖先名称数组拼 detail），深度 60 约 62 次；新实现按父级前缀增量拼接，应为 0 次。
    const joinSpy = vi.spyOn(Array.prototype, 'join');
    let items: ReturnType<typeof bookmarkIndex>;
    let joinCalls = -1;
    try {
      items = bookmarkIndex([deepChain(DEPTH)]);
    } finally {
      // 先取计数再恢复：mockRestore 会连同调用记录一起清空。
      joinCalls = joinSpy.mock.calls.length;
      joinSpy.mockRestore();
    }
    expect(joinCalls).toBe(0);
    // 省掉中间数组不等于省掉契约：完整路径仍是根到目标的全部层级。
    expect(items).toHaveLength(DEPTH + 2);
    expect(items.at(-1)!.detail).toBe(`浏览器书签 · ${['书签栏', ...Array.from({ length: DEPTH },
      (_, level) => `F${level}`)].join(' / ')}`);
    expect(items.at(-1)!.bookmarkPath).toHaveLength(DEPTH + 2);
  });

  it('同一次搜索对共享索引字段只判分一次，且不跨调用复用', () => {
    const DEPTH = 400;
    const items = bookmarkIndex([deepChain(DEPTH)]);
    // 口径：统计单次 searchLocalIndex 内 String.prototype.startsWith 的调用次数。
    // 「书签栏」出现在全部 402 条结果的字段里（共享同一 IndexedText），旧实现逐条重判
    // 约 8 万次；按字段身份在本次调用内缓存后，只需对每个不同字段判一次。
    const startsWithSpy = vi.spyOn(String.prototype, 'startsWith');
    let hits: ReturnType<typeof searchLocalIndex>;
    let startsWithCalls = -1;
    try {
      hits = searchLocalIndex({ index: items, query: '书签栏', sources: ALL_SOURCES });
    } finally {
      startsWithCalls = startsWithSpy.mock.calls.length;
      startsWithSpy.mockRestore();
    }
    expect(startsWithCalls).toBeLessThan(1_000);
    // 缓存不得改变命中集合与稳定顺序：所有条目都含根名，按索引顺序返回。
    expect(hits.map(({ id }) => id)).toEqual(items.map(({ id }) => id));
    // 第二次查询是独立调用，不复用上一次的判分缓存。
    expect(ids(searchLocalIndex({ index: items, query: 'F399', sources: ALL_SOURCES }))).toEqual(['f399', 'leaf']);
    expect(ids(searchLocalIndex({ index: items, query: 'F399', sources: ALL_SOURCES }))).toEqual(['f399', 'leaf']);
  });

  it('迭代实现与逐层重建祖先数组的参考实现逐项等价（自由树，含分隔符与异常节点）', () => {
    // 参考实现只表达契约：每层复制祖先名称/ID 数组后追加，detail 用整段 join。
    type Field = { readonly text: string; readonly full: string; readonly initials: string };
    const reference = (roots: readonly BookmarkSearchNode[], stalePrefix: string) => {
      const out: Array<{ id: string; kind: string; label: string; detail: string; value: string;
        fields: Field[]; bookmarkPath: string[]; bookmarkNodeId: string; unavailable?: boolean }> = [];
      const indexOf = (value: string): Field => {
        const normalized = value.normalize('NFKC').toLocaleLowerCase();
        return { text: normalized, full: normalized, initials: normalized };
      };
      const labelOf = (node: BookmarkSearchNode) => {
        if (node.title.length > 0) return node.title;
        if (node.kind === 'bookmark') {
          return shortcutDisplayName({ title: node.title, url: node.url ?? '' }) || '未命名书签';
        }
        return '未命名文件夹';
      };
      const walk = (nodes: readonly BookmarkSearchNode[], names: readonly string[], ids: readonly string[]) => {
        for (const node of nodes) {
          if (node.kind === 'separator') continue;
          const label = labelOf(node);
          if (node.kind === 'bookmark') {
            const unavailable = node.unusable || node.url === null || node.url.length === 0;
            const path = names.length > 0 ? names : ['浏览器书签'];
            out.push({ id: node.id, kind: 'bookmark', label,
              detail: `${stalePrefix}浏览器书签 · ${path.join(' / ')}`, value: unavailable ? '' : node.url!,
              fields: [label, ...(unavailable ? [] : [node.url!]), ...path].map(indexOf),
              bookmarkPath: [...ids, node.id], bookmarkNodeId: node.id,
              ...(unavailable ? { unavailable: true } : {}) });
            continue;
          }
          const path = [...names, label];
          out.push({ id: node.id, kind: 'bookmark-folder', label,
            detail: `${stalePrefix}浏览器书签 · ${path.join(' / ')}`, value: node.id,
            fields: [...path, '浏览器书签'].map(indexOf), bookmarkPath: [...ids, node.id],
            bookmarkNodeId: node.id });
          walk(node.children, [...names, label], [...ids, node.id]);
        }
      };
      walk(roots, [], []);
      return out;
    };
    const tree = [bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [
      bookmarkFolder({ id: 'a', title: 'A', children: [
        bookmark({ id: 'a1', title: '甲' }),
        bookmark({ id: 'a2', title: '', url: null }),
        bookmark({ id: 'a3', title: '坏', url: 'https://bad.example.com', unusable: true }),
        bookmarkFolder({ id: 'a-empty', title: '' }),
      ] }),
      separator('s'),
      bookmark({ id: 'root-link', title: '根链接' }),
      bookmarkFolder({ id: 'b', title: 'B', unusable: true, children: [
        bookmark({ id: 'b1', title: '甲', url: 'https://b1.example.com' }),
        bookmark({ id: 'b2', title: '甲', url: 'https://b1.example.com' }),
      ] }),
    ] })];
    expect(bookmarkIndex(tree)).toEqual(reference(tree, ''));
    // stale 前缀与「根直属链接」路径占位也是契约的一部分，单独覆盖。
    expect(bookmarkIndex(tree, 'stale')).toEqual(reference(tree, '上次读取 · '));
    const rootLevel = [bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [
      bookmark({ id: 'direct', title: '直属' }),
      bookmark({ id: 'direct-empty', title: '直属空', url: null }),
    ] })];
    expect(bookmarkIndex(rootLevel)).toEqual(reference(rootLevel, ''));
  });

  it('同一构建内每个原始字符串只转写一次，祖先路径不重复分配', () => {
    const counted = countingSpell();
    const items = buildLocalSearchIndex({ folders: [], shortcuts: [],
      transliterate: counted.transliterate,
      bookmarks: projection([bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [
        bookmarkFolder({ id: 'work', title: '工作', parentId: 'bar', children: [
          bookmark({ id: 'a', title: '文档' }),
          bookmark({ id: 'b', title: '文档' }),
        ] }),
      ] })]) });
    // 结果全量保留（含重复项），匹配也仍按祖先路径命中。
    expect(items.map(({ id }) => id)).toEqual(['bar', 'work', 'a', 'b']);
    expect(ids(searchLocalIndex({ index: items, query: '工作', sources: ALL_SOURCES }))).toEqual(['work', 'a', 'b']);
    expect(ids(searchLocalIndex({ index: items, query: '书签栏', sources: ALL_SOURCES })))
      .toEqual(['bar', 'work', 'a', 'b']);
    // 「书签栏」「工作」分别出现在 4 条与 3 条结果的字段里；共享索引后每个原始字符串只转写一次。
    const counts = new Map<string, number>();
    for (const value of counted.calls) counts.set(value, (counts.get(value) ?? 0) + 1);
    expect(counts.get('书签栏')).toBe(1);
    expect(counts.get('工作')).toBe(1);
    expect(counts.get('文档')).toBe(1);
    expect(counts.get('浏览器书签')).toBe(1);
    expect(counts.get('https://a.example.com')).toBe(1);
    expect(counts.get('https://b.example.com')).toBe(1);
    expect(counted.calls).toHaveLength(6);
  });

  it('转写缓存不跨构建复用：不同注入 spell 各自全量转写且结果随其变化', () => {
    const tree = [bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [
      bookmark({ id: 'docs', title: '文档' }),
    ] })];
    const first = countingSpell();
    const second = countingSpell();
    const firstItems = bookmarkIndexWith(tree, first.transliterate);
    const secondItems = bookmarkIndexWith(tree, second.transliterate);
    // 第二次构建没有命中第一次的缓存：同一批原始字符串再次交给注入的 spell。
    expect(second.calls).not.toHaveLength(0);
    expect(second.calls.toSorted()).toEqual(first.calls.toSorted());
    expect(secondItems[0]!.fields).toEqual(firstItems[0]!.fields);
    // 换成会改写拼音的 spell，第二次构建必须反映新 spell，而不是沿用旧缓存。
    const shifted = (value: string) => ({ full: `z${value}`, initials: `s${value}` });
    const shiftedItems = bookmarkIndexWith(tree, shifted);
    expect(shiftedItems.find(({ id }) => id === 'docs')).not.toEqual(firstItems.find(({ id }) => id === 'docs'));
    expect(ids(searchLocalIndex({ index: shiftedItems, query: 'z文档', sources: ALL_SOURCES }))).toEqual(['docs']);
    expect(ids(searchLocalIndex({ index: firstItems, query: 'z文档', sources: ALL_SOURCES }))).toEqual([]);
  });

  it('单条结果字段数超过参数上限时仍取最小分，不用 spread 传参', () => {
    // 20 万个字段会让 Math.min(...scores) 抛 RangeError：单条结果的字段数不受内容约束。
    const fields = Array.from({ length: 200_000 }, () => ({ text: 'q', full: 'q', initials: 'q' }));
    const item = { id: 'huge', kind: 'site' as const, label: 'q', detail: '', value: 'https://huge.example.com', fields };
    const items = searchLocalIndex({ index: [item], query: 'q', sources: ALL_SOURCES });
    expect(ids(items)).toEqual(['huge']);
  });

  it('深层嵌套完整索引，不静默截断也保留每一层完整路径', () => {
    const DEPTH = 60;
    let deepest = bookmark({ id: 'leaf', title: '深层链接', url: 'https://deep.example.com' });
    for (let level = DEPTH - 1; level >= 0; level -= 1) {
      deepest = bookmarkFolder({ id: `f${level}`, title: `层${level}`, children: [deepest] });
    }
    const items = bookmarkIndex([bookmarkFolder({ id: 'bar', title: '书签栏', kind: 'root', children: [deepest] })]);
    // 根 + 每层文件夹 + 最深链接，全部进入索引。
    expect(items).toHaveLength(DEPTH + 2);
    expect(items.at(-1)).toMatchObject({ id: 'leaf', kind: 'bookmark', value: 'https://deep.example.com' });
    // 最深结果的详情带根到父级的完整路径，不是只剩直接父名。
    expect(items.at(-1)!.detail).toBe(`浏览器书签 · ${['书签栏', ...Array.from({ length: DEPTH },
      (_, level) => `层${level}`)].join(' / ')}`);
    expect(ids(searchLocalIndex({ index: items, query: '深层链接', sources: ALL_SOURCES }))).toEqual(['leaf']);
    expect(ids(searchLocalIndex({ index: items, query: '层59', sources: ALL_SOURCES })))
      .toEqual([`f${DEPTH - 1}`, 'leaf']);
  });
});
