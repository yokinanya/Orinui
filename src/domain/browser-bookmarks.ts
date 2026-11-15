import { fail } from '@/domain/errors';

/**
 * 浏览器书签的只读领域模型。
 *
 * 本模块不接触浏览器 API、React 或 Dexie：它只负责把 `browser.bookmarks.getTree()`
 * 返回的原始树规范化为稳定结构，再派生区域/文件夹两种投影与隐藏匹配结果。
 * 浏览器书签由浏览器拥有，规范化结果只存在于内存与本地降级缓存，
 * 永不写入 Orinui 的 folders/shortcuts/assets/settings。
 *
 * 所有遍历都是迭代实现：书签树没有任意深度上限，深层合法数据不能因递归而消失。
 */

export const BOOKMARK_REGION_TITLE = '浏览器收藏夹';
export const BOOKMARK_UNCATEGORIZED_TITLE = '未分类';
const UNNAMED_TITLE = '（无标题）';

/**
 * 已知的浏览器内部虚拟根 id。
 *
 * Chrome 返回单个 `'0'` 虚拟根；Firefox 的 `getTree()` 直接返回各公开根。
 * 只有“已知虚拟身份 + 形状”同时成立时才移除容器；空白标题本身永远不足以判定，
 * 否则用户自建的空白标题根会被静默吞掉。
 */
const KNOWN_VIRTUAL_ROOT_IDS: ReadonlySet<string> = new Set(['0', 'root________']);

export type BrowserBookmarkKind = 'folder' | 'bookmark' | 'separator';
export type BookmarkProjectionMode = 'region' | 'folder';

/**
 * `bookmarks.BookmarkTreeNode` 的最小结构投影。
 *
 * 字段全部可选且类型宽松：浏览器（以及损坏的测试数据）可能缺少或给错字段，
 * 规范化阶段负责判定，而不是在类型上假装一定合法。
 */
export interface RawBookmarkNode {
  readonly id?: unknown;
  readonly parentId?: unknown;
  readonly index?: unknown;
  readonly title?: unknown;
  readonly url?: unknown;
  readonly type?: unknown;
  readonly unmodifiable?: unknown;
  readonly folderType?: unknown;
  readonly children?: readonly RawBookmarkNode[];
}

export interface BrowserBookmarkNode {
  readonly id: string;
  /** 浏览器根节点的父级内部虚拟根已被移除，因此根的 parentId 为 null。 */
  readonly parentId: string | null;
  /** 浏览器给定顺序中的位置；不从标题或使用频率重排。 */
  readonly index: number;
  /** 原样保留浏览器返回的标题，不去空白、不做大小写折叠。 */
  readonly title: string;
  /** 原始地址，原样保留；缺失时为 null，不等于“可打开”。 */
  readonly url: string | null;
  readonly kind: BrowserBookmarkKind;
  readonly isFolder: boolean;
  readonly unmodifiable: boolean;
  /** 从浏览器根标题开始到本节点的路径，只用于显示与隐藏规则回退匹配。 */
  readonly path: readonly string[];
  readonly children: readonly BrowserBookmarkNode[];
}

interface MutableBookmarkNode {
  id: string;
  parentId: string | null;
  index: number;
  title: string;
  url: string | null;
  kind: BrowserBookmarkKind;
  isFolder: boolean;
  unmodifiable: boolean;
  path: string[];
  children: BrowserBookmarkNode[];
}

export interface NormalizedBookmarkTree {
  readonly roots: readonly BrowserBookmarkNode[];
  /** 已移除内部虚拟根后的可见节点数（含分隔符）。 */
  readonly nodeCount: number;
  readonly linkCount: number;
  readonly folderCount: number;
  readonly separatorCount: number;
}

export interface BookmarkTreeIndex {
  readonly roots: readonly BrowserBookmarkNode[];
  readonly byId: ReadonlyMap<string, BrowserBookmarkNode>;
}

export interface BookmarkFolderLevel {
  readonly id: string;
  readonly title: string;
  readonly path: readonly string[];
  /** 该容器内可见的直接子项，顺序完全取自浏览器。 */
  readonly entries: readonly BrowserBookmarkNode[];
}

export interface BookmarkRegionGroup {
  readonly id: string;
  readonly rootId: string;
  readonly rootTitle: string;
  readonly folderId: string | null;
  readonly title: string;
  readonly path: readonly string[];
  /** 该分组内可见的直接子项（链接、分隔符与子文件夹），保持浏览器顺序。 */
  readonly entries: readonly BrowserBookmarkNode[];
}

export interface BookmarkRegionProjection {
  readonly mode: 'region';
  readonly title: typeof BOOKMARK_REGION_TITLE;
  readonly groups: readonly BookmarkRegionGroup[];
  readonly nodeCount: number;
  readonly linkCount: number;
  readonly folderCount: number;
}

export interface BookmarkFolderProjection {
  readonly mode: 'folder';
  readonly title: typeof BOOKMARK_REGION_TITLE;
  /** 顶层：每个浏览器根作为一个可进入的文件夹。 */
  readonly roots: readonly BookmarkFolderLevel[];
  /** 所有可见层级的索引；向下钻取时按容器节点 id 读取，不预先展开。 */
  readonly levels: ReadonlyMap<string, BookmarkFolderLevel>;
  readonly nodeCount: number;
  readonly linkCount: number;
  readonly folderCount: number;
}

export type BookmarkProjection = BookmarkRegionProjection | BookmarkFolderProjection;

export interface BookmarkHiddenRuleInput {
  readonly ruleId: string;
  readonly targetId: string;
  readonly path: readonly string[];
  readonly kind: 'root' | 'folder';
  readonly hidden: boolean;
  readonly updatedAt: number;
}

export interface BookmarkHiddenRuleMatch {
  readonly rule: BookmarkHiddenRuleInput;
  readonly nodeId: string;
  readonly matchedBy: 'id' | 'path';
  readonly candidates: readonly string[];
}

export interface BookmarkHiddenRulePending {
  readonly rule: BookmarkHiddenRuleInput;
  readonly status: 'ambiguous' | 'unmatched';
  readonly candidates: readonly string[];
}

export interface BookmarkHiddenResolution {
  /** 需要隐藏的根/文件夹节点 id（仅 `hidden: true` 且匹配成功的规则）。 */
  readonly hiddenNodeIds: ReadonlySet<string>;
  readonly matched: readonly BookmarkHiddenRuleMatch[];
  readonly pending: readonly BookmarkHiddenRulePending[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function rawTitle(raw: RawBookmarkNode): string {
  return typeof raw.title === 'string' ? raw.title : '';
}

function rawChildren(raw: RawBookmarkNode): readonly RawBookmarkNode[] | null {
  if (raw.children === undefined) return null;
  if (!Array.isArray(raw.children)) fail('浏览器书签树结构非法：children 不是数组');
  return raw.children;
}

function isVirtualRoot(raw: RawBookmarkNode): boolean {
  if (typeof raw.id !== 'string' || !KNOWN_VIRTUAL_ROOT_IDS.has(raw.id)) return false;
  if (raw.type === 'separator') return false;
  if (typeof raw.url === 'string') return false;
  const children = rawChildren(raw);
  return children !== null && rawTitle(raw) === '';
}

function orderChildren(children: readonly RawBookmarkNode[]): readonly RawBookmarkNode[] {
  const indexed = children.every((child) =>
    typeof child.index === 'number' && Number.isInteger(child.index) && child.index >= 0);
  if (!indexed) return children;
  return children
    .map((child, position) => ({ child, index: child.index as number, position }))
    .sort((left, right) => left.index - right.index || left.position - right.position)
    .map(({ child }) => child);
}

interface NormalizeQueueItem {
  readonly raw: RawBookmarkNode;
  readonly isRoot: boolean;
  readonly expectedParentRawId: string | null;
  readonly parentId: string | null;
  readonly parentPath: readonly string[];
  readonly index: number;
  /** 父节点的 children 数组；顶层为 null，节点进入 roots。 */
  readonly sink: BrowserBookmarkNode[] | null;
}

interface NormalizeAccumulator {
  readonly ids: Set<string>;
  readonly objects: WeakSet<object>;
  nodeCount: number;
  linkCount: number;
  folderCount: number;
  separatorCount: number;
}

function createNode(
  raw: RawBookmarkNode,
  item: NormalizeQueueItem,
  accumulator: NormalizeAccumulator,
): { node: MutableBookmarkNode; children: readonly RawBookmarkNode[] } {
  if (!isRecord(raw)) fail('浏览器书签树结构非法：节点不是对象');
  // 同一个对象再次出现说明父子成环（含自引用）；重复 id 也在下一刻被拒绝。
  if (accumulator.objects.has(raw)) fail('浏览器书签树结构非法：父子成环');
  accumulator.objects.add(raw);

  const id = raw.id;
  if (typeof id !== 'string' || id === '') fail('浏览器书签树结构非法：节点缺少 id');
  if (accumulator.ids.has(id)) fail(`浏览器书签树结构非法：节点 id 重复（${id}）`);
  accumulator.ids.add(id);

  if (item.isRoot) {
    // 公开根是树的入口。Chrome 的内部虚拟根已在下一步移除，因此顶层节点必须指向它；
    // Firefox 的 `getTree()` 直接返回各公开根，其 parentId 指向未返回的容器，不能据此判失败。
    // 非顶层节点始终严格要求 parentId 等于实际父节点。
    if (item.expectedParentRawId !== null && raw.parentId !== item.expectedParentRawId) {
      fail('浏览器书签树结构非法：根节点的 parentId 指向未知节点');
    }
  } else if (typeof raw.parentId !== 'string' || raw.parentId !== item.expectedParentRawId) {
    fail('浏览器书签树结构非法：节点 parentId 缺失或与实际父节点不一致');
  }

  const children = rawChildren(raw);
  if (raw.type === 'separator' && children !== null && children.length > 0) {
    fail('浏览器书签树结构非法：分隔符不能包含子节点');
  }

  // 浏览器明确给出 type: 'folder' 时，即使 children 缺失也必须是空文件夹；
  // 反过来，非 separator 且带 children 的节点也是文件夹。
  const kind: BrowserBookmarkKind = raw.type === 'separator'
    ? 'separator'
    : raw.type === 'folder' || children !== null ? 'folder' : 'bookmark';

  const title = rawTitle(raw);
  const path = item.isRoot ? [title] : [...item.parentPath, title];
  accumulator.nodeCount += 1;
  if (kind === 'bookmark') accumulator.linkCount += 1;
  if (kind === 'folder') accumulator.folderCount += 1;
  if (kind === 'separator') accumulator.separatorCount += 1;

  const node: MutableBookmarkNode = {
    id,
    parentId: item.parentId,
    index: item.index,
    title,
    url: typeof raw.url === 'string' ? raw.url : null,
    kind,
    isFolder: kind === 'folder',
    unmodifiable: typeof raw.unmodifiable === 'string',
    path,
    children: [],
  };
  return { node, children: kind === 'folder' ? children ?? [] : [] };
}

/** 空白标题回退到原始地址；两者都缺失时给出明确占位，而不是抛出读取错误。 */
export function bookmarkDisplayName(node: Pick<BrowserBookmarkNode, 'title' | 'url'>): string {
  if (node.title !== '') return node.title;
  if (node.url !== null && node.url !== '') return node.url;
  return UNNAMED_TITLE;
}

/**
 * 是否可以交给浏览器打开。
 *
 * 不做协议白名单（`javascript:` / `data:` / `chrome://` 等仍可委托，由浏览器自行拒绝或处理），
 * 但缺失地址或无法解析的地址必须在界面标记为不可用，不能假装可打开。
 */
export function isOpenableBookmark(node: BookmarkBrowserNodeIdentity): boolean {
  if (node.kind !== 'bookmark' || typeof node.url !== 'string') return false;
  const raw = node.url;
  if (raw.trim() === '') return false;
  try {
    new URL(raw);
    return true;
  } catch {
    return false;
  }
}

type BookmarkBrowserNodeIdentity = Pick<BrowserBookmarkNode, 'kind' | 'url'>;

/** 分隔符与不可打开节点不进入搜索索引；它们仍然可见。 */
export function isSearchableBookmark(node: BrowserBookmarkNode): boolean {
  return isOpenableBookmark(node);
}

interface Counts {
  nodeCount: number;
  linkCount: number;
  folderCount: number;
}

function countNodes(roots: readonly BrowserBookmarkNode[], hidden: ReadonlySet<string>): Counts {
  let nodeCount = 0;
  let linkCount = 0;
  let folderCount = 0;
  const stack: BrowserBookmarkNode[] = [...roots];
  while (stack.length > 0) {
    const node = stack.pop() as BrowserBookmarkNode;
    if (hidden.has(node.id)) continue;
    nodeCount += 1;
    if (node.kind === 'bookmark') linkCount += 1;
    if (node.kind === 'folder') folderCount += 1;
    for (const child of node.children) stack.push(child);
  }
  return { nodeCount, linkCount, folderCount };
}

/**
 * 规范化浏览器书签树。
 *
 * - 只有已知内部虚拟根（Chrome `'0'` / Firefox `'root________'`）且形状匹配时移除；
 *   单个空白标题的公开根原样保留。
 * - 顺序取自浏览器 `index`；没有完整 `index` 时沿用 API 返回顺序。
 * - 标题、地址、重复项、空文件夹与分隔符全部原样保留，不做去重或协议过滤。
 * - 缺 id、id 重复、父引用缺失/不一致、父子成环、children 结构非法时整次失败，
 *   由调用方进入明确错误或 stale 状态，不返回部分修补后的“成功”树。
 */
export function normalizeBookmarkTree(raw: unknown): NormalizedBookmarkTree {
  if (!Array.isArray(raw)) fail('浏览器书签树结构非法：顶层不是数组');
  const topLevel = raw as readonly RawBookmarkNode[];
  if (topLevel.length === 0) fail('浏览器书签树结构非法：顶层为空');

  const first = topLevel[0] as RawBookmarkNode;
  const virtualRoot = topLevel.length === 1 && isVirtualRoot(first) ? first : null;
  const rootsRaw = virtualRoot === null ? topLevel : rawChildren(virtualRoot) ?? [];
  const virtualRootId = virtualRoot === null ? null : virtualRoot.id as string;

  const accumulator: NormalizeAccumulator = {
    ids: new Set(),
    objects: new WeakSet(),
    nodeCount: 0,
    linkCount: 0,
    folderCount: 0,
    separatorCount: 0,
  };
  const roots: BrowserBookmarkNode[] = [];
  const queue: NormalizeQueueItem[] = orderChildren(rootsRaw).map((node, index) => ({
    raw: node,
    isRoot: true,
    expectedParentRawId: virtualRootId,
    parentId: null,
    parentPath: [],
    index,
    sink: null,
  }));

  for (let position = 0; position < queue.length; position += 1) {
    const item = queue[position] as NormalizeQueueItem;
    const { node, children } = createNode(item.raw, item, accumulator);
    if (item.sink === null) roots.push(node); else item.sink.push(node);
    const ordered = orderChildren(children);
    for (let index = 0; index < ordered.length; index += 1) {
      queue.push({
        raw: ordered[index] as RawBookmarkNode,
        isRoot: false,
        expectedParentRawId: node.id,
        parentId: node.id,
        parentPath: node.path,
        index,
        sink: node.children,
      });
    }
  }

  return {
    roots,
    nodeCount: accumulator.nodeCount,
    linkCount: accumulator.linkCount,
    folderCount: accumulator.folderCount,
    separatorCount: accumulator.separatorCount,
  };
}

interface ParseQueueItem {
  readonly value: unknown;
  readonly parentId: string | null;
  readonly parentPath: readonly string[];
  readonly sink: BrowserBookmarkNode[] | null;
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

/**
 * 校验本地缓存里的规范化树；损坏时明确失败，不把半份数据当成实时结果。
 *
 * 路径必须逐段等于祖先标题序列；否则隐藏规则的路径回退可能绑定到错误文件夹。
 */
export function parseNormalizedBookmarkTree(value: unknown): NormalizedBookmarkTree {
  if (!isRecord(value) || !Array.isArray(value.roots)) fail('书签缓存损坏：缺少根节点列表');

  const ids = new Set<string>();
  const roots: BrowserBookmarkNode[] = [];
  const queue: ParseQueueItem[] = (value.roots as unknown[]).map((root) => ({
    value: root,
    parentId: null,
    parentPath: [],
    sink: null,
  }));
  let nodeCount = 0;
  let linkCount = 0;
  let folderCount = 0;
  let separatorCount = 0;

  for (let position = 0; position < queue.length; position += 1) {
    const item = queue[position] as ParseQueueItem;
    const node = item.value;
    if (!isRecord(node)) fail('书签缓存损坏：节点不是对象');
    const id = node.id;
    if (typeof id !== 'string' || id === '') fail('书签缓存损坏：节点缺少 id');
    if (ids.has(id)) fail(`书签缓存损坏：节点 id 重复（${id}）`);
    ids.add(id);

    const kind = node.kind;
    if (kind !== 'folder' && kind !== 'bookmark' && kind !== 'separator') {
      fail('书签缓存损坏：节点类型未知');
    }
    if (node.parentId !== item.parentId) fail('书签缓存损坏：父引用不一致');
    if (typeof node.title !== 'string') fail('书签缓存损坏：标题不是文本');
    if (node.url !== null && typeof node.url !== 'string') fail('书签缓存损坏：地址不是文本');
    if (node.isFolder !== (kind === 'folder')) fail('书签缓存损坏：文件夹标记不一致');
    if (typeof node.unmodifiable !== 'boolean') fail('书签缓存损坏：只读标记不是布尔值');
    if (typeof node.index !== 'number' || !Number.isInteger(node.index) || node.index < 0) {
      fail('书签缓存损坏：序号非法');
    }
    if (!Array.isArray(node.path) || node.path.some((segment) => typeof segment !== 'string')) {
      fail('书签缓存损坏：路径非法');
    }
    const expectedPath = [...item.parentPath, node.title];
    if (!samePath(node.path as string[], expectedPath)) fail('书签缓存损坏：路径与祖先标题不一致');
    if (!Array.isArray(node.children)) fail('书签缓存损坏：子节点不是数组');
    if (kind !== 'folder' && node.children.length > 0) fail('书签缓存损坏：非文件夹包含子节点');

    const shell: MutableBookmarkNode = {
      id,
      parentId: item.parentId,
      index: node.index,
      title: node.title,
      url: node.url,
      kind,
      isFolder: kind === 'folder',
      unmodifiable: node.unmodifiable,
      path: [...expectedPath],
      children: [],
    };
    nodeCount += 1;
    if (kind === 'bookmark') linkCount += 1;
    if (kind === 'folder') folderCount += 1;
    if (kind === 'separator') separatorCount += 1;

    if (item.sink === null) roots.push(shell); else item.sink.push(shell);
    for (const child of node.children as unknown[]) {
      queue.push({ value: child, parentId: id, parentPath: expectedPath, sink: shell.children });
    }
  }

  return { roots, nodeCount, linkCount, folderCount, separatorCount };
}

export function createBookmarkTreeIndex(tree: NormalizedBookmarkTree): BookmarkTreeIndex {
  const byId = new Map<string, BrowserBookmarkNode>();
  const stack: BrowserBookmarkNode[] = [...tree.roots];
  while (stack.length > 0) {
    const node = stack.pop() as BrowserBookmarkNode;
    byId.set(node.id, node);
    for (const child of node.children) stack.push(child);
  }
  return { roots: tree.roots, byId };
}

function visibleEntries(node: BrowserBookmarkNode, hidden: ReadonlySet<string>): readonly BrowserBookmarkNode[] {
  return node.children.filter((child) => !hidden.has(child.id));
}

function buildFolderLevels(roots: readonly BrowserBookmarkNode[], hidden: ReadonlySet<string>): {
  readonly topLevels: readonly BookmarkFolderLevel[];
  readonly levels: ReadonlyMap<string, BookmarkFolderLevel>;
} {
  const levels = new Map<string, BookmarkFolderLevel>();
  const topLevels: BookmarkFolderLevel[] = [];
  const visibleRoots = roots.filter((root) => !hidden.has(root.id));
  const stack: BrowserBookmarkNode[] = [...visibleRoots].reverse();
  while (stack.length > 0) {
    const container = stack.pop() as BrowserBookmarkNode;
    const level: BookmarkFolderLevel = {
      id: container.id,
      title: bookmarkDisplayName(container),
      path: container.path,
      entries: visibleEntries(container, hidden),
    };
    levels.set(container.id, level);
    if (container.parentId === null) topLevels.push(level);
    const folders = level.entries.filter((entry) => entry.kind === 'folder');
    for (let index = folders.length - 1; index >= 0; index -= 1) stack.push(folders[index] as BrowserBookmarkNode);
  }
  return { topLevels, levels };
}

function buildRegionGroups(roots: readonly BrowserBookmarkNode[], hidden: ReadonlySet<string>): readonly BookmarkRegionGroup[] {
  const groups: BookmarkRegionGroup[] = [];
  const stack: { container: BrowserBookmarkNode; root: BrowserBookmarkNode }[] = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const root = roots[index] as BrowserBookmarkNode;
    if (!hidden.has(root.id)) stack.push({ container: root, root });
  }
  while (stack.length > 0) {
    const { container, root } = stack.pop() as { container: BrowserBookmarkNode; root: BrowserBookmarkNode };
    const entries = visibleEntries(container, hidden);
    groups.push({
      id: container.id === root.id ? `root:${root.id}` : `folder:${container.id}`,
      rootId: root.id,
      rootTitle: root.title,
      folderId: container.id === root.id ? null : container.id,
      title: container.id === root.id ? BOOKMARK_UNCATEGORIZED_TITLE : bookmarkDisplayName(container),
      path: container.path,
      entries,
    });
    const folders = entries.filter((entry) => entry.kind === 'folder');
    for (let index = folders.length - 1; index >= 0; index -= 1) {
      stack.push({ container: folders[index] as BrowserBookmarkNode, root });
    }
  }
  return groups;
}

export interface BookmarkProjectionOptions {
  readonly mode: BookmarkProjectionMode;
  readonly hidden?: ReadonlySet<string>;
}

/**
 * 派生只读投影。
 *
 * - 区域模式：唯一固定标题「浏览器收藏夹」，每个根先出现「未分类」分组（根的直接链接与子文件夹），
 *   随后按浏览器顺序为每个嵌套文件夹生成完整路径分组；分组内条目保持浏览器顺序。
 * - 文件夹模式：顶层是浏览器根（作为文件夹），每一层只包含直接子项；通过 `levels`
 *   按容器 id 继续钻取，不预先展开整棵树。
 * - 两种模式都覆盖全部根，不提供来源选择，不设任意深度上限；隐藏根/文件夹会连同后代一起跳过。
 */
export function projectBookmarkTree(
  tree: NormalizedBookmarkTree,
  options: BookmarkProjectionOptions,
): BookmarkProjection {
  const hidden = options.hidden ?? new Set<string>();
  const counts = countNodes(tree.roots, hidden);
  if (options.mode === 'folder') {
    const { topLevels, levels } = buildFolderLevels(tree.roots, hidden);
    return { mode: 'folder', title: BOOKMARK_REGION_TITLE, roots: topLevels, levels, ...counts };
  }
  return {
    mode: 'region',
    title: BOOKMARK_REGION_TITLE,
    groups: buildRegionGroups(tree.roots, hidden),
    ...counts,
  };
}

/** NFKC + trim + 大小写折叠，逐段执行；路径从浏览器根开始。 */
export function normalizeBookmarkPath(path: readonly string[]): readonly string[] {
  return path.map((segment) => segment.normalize('NFKC').trim().toLowerCase());
}

function isRuleTarget(node: BrowserBookmarkNode, kind: BookmarkHiddenRuleInput['kind']): boolean {
  // 隐藏粒度只有浏览器根与普通文件夹；根必须是文件夹，避免把异常数据里的链接根当成可隐藏容器。
  if (node.kind !== 'folder') return false;
  return kind === 'root' ? node.parentId === null : node.parentId !== null;
}

function pathKey(path: readonly string[]): string {
  return JSON.stringify(normalizeBookmarkPath(path));
}

/**
 * 解析隐藏规则（只在内存执行）。
 *
 * 先按浏览器节点 id 命中，再按规范化完整路径回退；路径必须唯一。
 * 路径不唯一标记 `ambiguous`、无匹配标记 `unmatched`，两者都保留规则且不隐藏任何内容。
 * 只接受 `root` / `folder`；`hidden: false` 保留规则但不会取消父级隐藏。
 * 解析结果（待确认状态）是每台设备按当前树推导的界面状态，不写回规则、不落库。
 *
 * 工作按需展开：没有规则时不遍历树、不建任何索引；ID 优先，只有出现需要路径回退的
 * 规则时才惰性建立一次路径索引。深层合法树因此不会因为「解析空规则」而付出全树路径归一化。
 */
export function resolveHiddenRules(
  tree: NormalizedBookmarkTree,
  rules: readonly BookmarkHiddenRuleInput[],
): BookmarkHiddenResolution {
  const hiddenNodeIds = new Set<string>();
  const matched: BookmarkHiddenRuleMatch[] = [];
  const pending: BookmarkHiddenRulePending[] = [];
  if (rules.length === 0) return { hiddenNodeIds, matched, pending };

  const index = createBookmarkTreeIndex(tree);

  // 惰性路径索引：只在真的有规则需要路径回退时建立一次，之后同一批规则共用。
  // 按文档顺序（父先于子、兄弟按浏览器顺序）建立，候选列表才稳定。
  let byPath: Map<string, BrowserBookmarkNode[]> | null = null;
  const pathCandidates = (path: readonly string[]): readonly BrowserBookmarkNode[] => {
    if (byPath === null) {
      const built = new Map<string, BrowserBookmarkNode[]>();
      const queue: BrowserBookmarkNode[] = [...tree.roots];
      for (let position = 0; position < queue.length; position += 1) {
        const node = queue[position] as BrowserBookmarkNode;
        if (node.kind === 'folder') {
          const key = pathKey(node.path);
          const list = built.get(key);
          if (list) list.push(node); else built.set(key, [node]);
        }
        queue.push(...node.children);
      }
      byPath = built;
    }
    return byPath.get(pathKey(path)) ?? [];
  };

  const ordered = [...rules].sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  for (const rule of ordered) {
    if (rule.kind !== 'root' && rule.kind !== 'folder') {
      pending.push({ rule, status: 'unmatched', candidates: [] });
      continue;
    }
    const direct = index.byId.get(rule.targetId);
    if (direct && isRuleTarget(direct, rule.kind)) {
      matched.push({ rule, nodeId: direct.id, matchedBy: 'id', candidates: [direct.id] });
      if (rule.hidden) hiddenNodeIds.add(direct.id);
      continue;
    }
    const candidates = pathCandidates(rule.path).filter((node) => isRuleTarget(node, rule.kind));
    if (candidates.length === 1) {
      const node = candidates[0] as BrowserBookmarkNode;
      matched.push({ rule, nodeId: node.id, matchedBy: 'path', candidates: [node.id] });
      if (rule.hidden) hiddenNodeIds.add(node.id);
    } else if (candidates.length > 1) {
      pending.push({ rule, status: 'ambiguous', candidates: candidates.map((node) => node.id) });
    } else {
      pending.push({ rule, status: 'unmatched', candidates: direct ? [direct.id] : [] });
    }
  }

  return { hiddenNodeIds, matched, pending };
}
