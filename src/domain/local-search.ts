import type { Folder } from '@/domain/folder';
import { shortcutDisplayName, type Shortcut } from '@/domain/shortcut';

export interface SearchSpelling { readonly full: string; readonly initials: string }
export type TransliterateSearchText = (text: string) => SearchSpelling;
interface IndexedText extends SearchSpelling { readonly text: string }

/**
 * 浏览器书签投影里参与搜索的节点形状。
 *
 * 与平台层规范化后的浏览器节点结构兼容：搜索只读取投影结果，不调用浏览器 API，
 * 也不重复应用隐藏规则。投影就是全部可见内容，不含被隐藏的节点，也不做内容或深度截断。
 */
export interface BookmarkSearchNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly index: number;
  readonly title: string;
  readonly url: string | null;
  readonly kind: 'root' | 'folder' | 'bookmark' | 'separator';
  /** 结构或地址异常、无法安全激活的节点；标题仍可被搜索到。 */
  readonly unusable: boolean;
  readonly children: readonly BookmarkSearchNode[];
}

export type BookmarkSearchStatus = 'disabled' | 'loading' | 'ready' | 'stale' | 'error' | 'permission-missing' | 'unsupported';

/** 调用方已完成状态判定与隐藏投影的书签快照；搜索不自行读缓存或权限。 */
export interface BookmarkSearchProjection {
  readonly tree: readonly BookmarkSearchNode[];
  readonly status: BookmarkSearchStatus;
  readonly readAt: number | null;
  readonly error: string | null;
}

export interface LocalSearchItem {
  readonly id: string;
  readonly kind: 'site' | 'folder' | 'bookmark' | 'bookmark-folder';
  readonly label: string;
  readonly detail: string;
  readonly value: string;
  readonly fields: readonly IndexedText[];
  /** 浏览器书签节点在当前投影内的标识路径（根 → 目标）；只在本投影内有效。 */
  readonly bookmarkPath?: readonly string[];
  /** 浏览器书签节点 ID；激活时用它定位当前快照中的节点，不落库。 */
  readonly bookmarkNodeId?: string;
  /** 不能安全激活（无地址或结构不可用）；标题仍可搜索，激活时显示原因。 */
  readonly unavailable?: boolean;
}

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase();
const MATCH_SCORES = { exact: 0, prefix: 1, includes: 2, pinyin: 3, initials: 4 } as const;
const HOME_PATH = '主页';
const PATH_SEPARATOR = ' / ';
const BOOKMARK_SOURCE = '浏览器书签';
const STALE_PREFIX = '上次读取 · ';
const UNNAMED_BOOKMARK = '未命名书签';
const UNNAMED_FOLDER = '未命名文件夹';

function indexText(value: string, spell: TransliterateSearchText): IndexedText {
  const spelling = spell(value);
  return { text: normalize(value), full: normalize(spelling.full), initials: normalize(spelling.initials) };
}

/** 单次构建内的「原始字符串 → 索引文本」共享表。 */
type IndexSearchText = (value: string) => IndexedText;

/**
 * 每次构建新建一张缓存：同一原始字符串（祖先文件夹名、重复标题、来源标签）只转拼音并归一化一次。
 *
 * 缓存只活在一次构建内，调用方只按投影身份记忆化整份结果，因此不会跨构建、也不会在
 * 不同注入 `spell` 之间串用。索引文本只读，被多条结果的 `fields` 共享是安全的。
 */
function createTextIndexer(spell: TransliterateSearchText): IndexSearchText {
  const cache = new Map<string, IndexedText>();
  return (value) => {
    const cached = cache.get(value);
    if (cached !== undefined) return cached;
    const indexed = indexText(value, spell);
    cache.set(value, indexed);
    return indexed;
  };
}

/** 从根到目标文件夹的名称路径；父引用缺失或成环时停在可确定处，不伪造层级。 */
function folderPathNames(folders: readonly Folder[], folderId: string): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(folderId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }
  return names;
}

function siteItem(input: { readonly site: Shortcut; readonly folderPath: readonly string[];
  readonly index: IndexSearchText }): LocalSearchItem {
  const { site, folderPath, index } = input;
  const name = shortcutDisplayName(site);
  const fullPath = [HOME_PATH, ...folderPath].join(PATH_SEPARATOR);
  return { id: site.id, kind: 'site', label: name, detail: `${fullPath} · ${site.url}`,
    value: site.url,
    fields: [name, site.url, ...folderPath].map((value) => index(value)) };
}

export function buildLocalSearchIndex(input: { readonly shortcuts: readonly Shortcut[];
  readonly folders: readonly Folder[]; readonly transliterate: TransliterateSearchText;
  readonly bookmarks?: BookmarkSearchProjection }): readonly LocalSearchItem[] {
  const byId = new Map(input.folders.map((folder) => [folder.id, folder]));
  // 自有网站/文件夹与书签共用同一次构建的转写缓存，祖先路径名称只索引一次。
  const index = createTextIndexer(input.transliterate);
  const sites = input.shortcuts.flatMap((site) => {
    const folder = site.folderId === null ? undefined : byId.get(site.folderId);
    if (site.folderId !== null && !folder) return [];
    const folderPath = site.folderId === null ? [] : folderPathNames(input.folders, site.folderId);
    return [siteItem({ site, folderPath, index })];
  });
  const folders = input.folders.map((folder): LocalSearchItem => {
    const path = folderPathNames(input.folders, folder.id);
    return { id: folder.id, kind: 'folder', label: `打开文件夹「${folder.name}」`,
      detail: `本地文件夹 · ${[HOME_PATH, ...path].join(PATH_SEPARATOR)}`, value: folder.id,
      fields: path.map((value) => index(value)) };
  });
  return [...sites, ...folders, ...collectBookmarkSearchItems(input.bookmarks, index)];
}

/**
 * 独立构建浏览器书签结果。
 *
 * 调用方按投影身份记忆化，避免每次输入都重算拼音；只有处于可见、可读状态的
 * 投影才进入索引，stale 的每条结果都标记上次读取。遍历用显式栈（任意深度不增加
 * 调用栈），顺序与递归 DFS 先序一致：父文件夹在其全部后代之前，兄弟保持原顺序。
 */
export function buildBookmarkSearchIndex(projection: BookmarkSearchProjection | undefined,
  spell: TransliterateSearchText): readonly LocalSearchItem[] {
  return collectBookmarkSearchItems(projection, createTextIndexer(spell));
}

/** 与自有数据共享同一次构建的转写缓存。 */
function collectBookmarkSearchItems(projection: BookmarkSearchProjection | undefined,
  index: IndexSearchText): readonly LocalSearchItem[] {
  if (!projection) return [];
  if (projection.status !== 'ready' && projection.status !== 'stale') return [];
  const stalePrefix = projection.status === 'stale' ? STALE_PREFIX : '';
  const items: LocalSearchItem[] = [];
  const source = index(BOOKMARK_SOURCE);
  /**
   * 单条可 push/pop 的当前路径：进入子层追加一个元素，离开时弹出一个。
   *
   * 之前每层都复制整份祖先名称与 ID 数组，深链会产生 O(depth²) 个复制槽位；这里只在
   * 一处保存祖先状态，每条结果仍按输出契约拿到自己的 `bookmarkPath` / `fields`。
   * `ancestorFields` 与祖先名称一一对应，存的是已索引好的共享只读字段，避免逐层重新
   * 包装，也不再需要单独保存名称数组。`pathText` 是根到当前父级的完整路径前缀，
   * 子层只追加，不再逐层 `join`。
   */
  const ids: string[] = [];
  const ancestorFields: IndexedText[] = [];
  interface WalkFrame { readonly nodes: readonly BookmarkSearchNode[]; next: number;
    readonly pathText: string }
  const stack: WalkFrame[] = [{ nodes: projection.tree, next: 0, pathText: '' }];
  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    if (frame.next >= frame.nodes.length) {
      stack.pop();
      // 根帧没有压入路径元素，只有子层帧出栈时才回退一层。
      if (stack.length > 0) { ids.pop(); ancestorFields.pop(); }
      continue;
    }
    const node = frame.nodes[frame.next]!;
    // 原地推进游标：父级暂停在当前位置，等子层全部处理完再取下一个兄弟。
    frame.next += 1;
    if (node.kind === 'separator') continue;
    const label = bookmarkTitle(node);
    const labelField = index(label);
    const pathText = frame.pathText.length > 0
      ? `${frame.pathText}${PATH_SEPARATOR}${label}` : label;
    const bookmarkPath = new Array<string>(ids.length + 1);
    for (let at = 0; at < ids.length; at += 1) bookmarkPath[at] = ids[at]!;
    bookmarkPath[ids.length] = node.id;
    if (node.kind === 'bookmark') {
      const unavailable = node.unusable || node.url === null || node.url.length === 0;
      const hasAncestors = ancestorFields.length > 0;
      // 与之前一致：根直属链接用来源名占位路径，其余用祖先文件夹名。
      const fields = new Array<IndexedText>((unavailable ? 1 : 2) + (hasAncestors ? ancestorFields.length : 1));
      fields[0] = labelField;
      let at = 1;
      if (!unavailable) fields[at++] = index(node.url!);
      if (hasAncestors) {
        for (let step = 0; step < ancestorFields.length; step += 1) fields[at + step] = ancestorFields[step]!;
      } else {
        fields[at] = source;
      }
      items.push({ id: node.id, kind: 'bookmark', label,
        detail: `${stalePrefix}${BOOKMARK_SOURCE} · ${hasAncestors ? frame.pathText : BOOKMARK_SOURCE}`,
        value: unavailable ? '' : node.url!,
        fields,
        bookmarkPath,
        bookmarkNodeId: node.id,
        ...(unavailable ? { unavailable: true } : {}) });
      continue;
    }
    const fields = new Array<IndexedText>(ancestorFields.length + 2);
    for (let step = 0; step < ancestorFields.length; step += 1) fields[step] = ancestorFields[step]!;
    fields[ancestorFields.length] = labelField;
    fields[ancestorFields.length + 1] = source;
    items.push({ id: node.id, kind: 'bookmark-folder', label,
      detail: `${stalePrefix}${BOOKMARK_SOURCE} · ${pathText}`,
      // 激活只按投影内节点 ID 定位，不落库、不跨投影复用。
      value: node.id,
      fields,
      bookmarkPath,
      bookmarkNodeId: node.id });
    ids.push(node.id);
    ancestorFields.push(labelField);
    stack.push({ nodes: node.children, next: 0, pathText });
  }
  return items;
}

function bookmarkTitle(node: BookmarkSearchNode): string {
  if (node.title.length > 0) return node.title;
  if (node.kind === 'bookmark') return shortcutDisplayName({ title: node.title, url: node.url ?? '' }) || UNNAMED_BOOKMARK;
  return UNNAMED_FOLDER;
}

function fieldScore(field: IndexedText, needle: string, compact: string): number | null {
  if (field.text === needle) return MATCH_SCORES.exact;
  if (field.text.startsWith(needle)) return MATCH_SCORES.prefix;
  if (field.text.includes(needle)) return MATCH_SCORES.includes;
  if (field.full.includes(compact)) return MATCH_SCORES.pinyin;
  return field.initials.includes(compact) ? MATCH_SCORES.initials : null;
}

interface SearchSources {
  readonly showSites: boolean;
  readonly showFolders: boolean;
  /** 来自 settings.bookmarks.showInSearch；缺省按关闭处理，避免漏传时泄露书签结果。 */
  readonly showBookmarks?: boolean;
}

function sourceEnabled(kind: LocalSearchItem['kind'], sources: SearchSources): boolean {
  if (kind === 'site') return sources.showSites;
  if (kind === 'folder') return sources.showFolders;
  return sources.showBookmarks === true;
}

export function searchLocalIndex(input: { readonly index: readonly LocalSearchItem[]; readonly query: string;
  readonly sources: SearchSources }): readonly LocalSearchItem[] {
  const needle = normalize(input.query.trim());
  if (!needle) return [];
  // `needle` 已经 trim 过，压缩空白后用于拼音匹配；只在调用开始时算一次。
  const compact = needle.replace(/\s+/gu, '');
  /**
   * 本次调用内按字段身份记忆判分结果。
   *
   * 索引文本在一次构建内是共享的只读对象（同一祖先名、同一来源标签会出现在大量结果的
   * `fields` 里），所以同一字段对同一 `needle` 的分数恒定。缓存只活在这次调用内，
   * 换查询或换构建都不会命中，也不会跨调用保留。
   */
  const scored = new Map<IndexedText, number | null>();
  return input.index.flatMap((item) => {
    if (!sourceEnabled(item.kind, input.sources)) return [];
    // 迭代取最小值：单条结果的字段数不受内容限制，spread 会触到参数上限。
    let best = Number.POSITIVE_INFINITY;
    for (const field of item.fields) {
      let score = scored.get(field);
      if (score === undefined) {
        score = fieldScore(field, needle, compact);
        scored.set(field, score);
      }
      if (score !== null && score < best) best = score;
    }
    return best === Number.POSITIVE_INFINITY ? [] : [{ item, score: best }];
  }).toSorted((a, b) => a.score - b.score).map(({ item }) => item);
}
