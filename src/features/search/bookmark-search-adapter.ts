import type { BookmarkSearchNode, BookmarkSearchProjection, BookmarkSearchStatus } from '@/domain/local-search';
import { bookmarkAddressState, type BookmarkContextValue, type BookmarkNodeView, type BookmarkRootView,
  type BookmarkViewSnapshot, type BookmarkViewStatus } from '@/features/bookmarks/bookmark-view';

/**
 * 浏览器书签视图快照 → 搜索投影。
 *
 * 搜索模块不读浏览器 API、权限或缓存：这里只把书签功能所有者已经算好的快照
 * （含状态、隐藏节点与全量未截断的树）映射成搜索用的结构，并按显式栈覆盖隐藏根或
 * 文件夹的全部后代，保证它们都不出现在搜索结果里。任意深度都不增加调用栈，
 * 也不丢弃或重排条目。
 *
 * 状态映射保持语义：`importing` 期间视图保留上一份完整结果，因此按 `ready` 索引；
 * `disabled` / `permission-missing` / `unsupported` / `loading` / `error` 不产生结果。
 * 地址可交给浏览器的判断复用 `bookmarkAddressState`：缺协议或空地址的链接仍可被
 * 标题搜索到，但标记为不可激活，不会执行。
 */
const SEARCH_STATUS: Record<BookmarkViewStatus, BookmarkSearchStatus> = {
  disabled: 'disabled',
  unsupported: 'unsupported',
  'permission-missing': 'permission-missing',
  loading: 'loading',
  ready: 'ready',
  stale: 'stale',
  importing: 'ready',
  error: 'error',
};
function hiddenSet(snapshot: BookmarkViewSnapshot): ReadonlySet<string> {
  return new Set(snapshot.hiddenNodeIds);
}

/** 构造期可写 `children` 的内部形状；对外仍是只读的 `BookmarkSearchNode`。 */
interface SearchNodeDraft {
  id: string;
  parentId: string | null;
  index: number;
  title: string;
  url: string | null;
  kind: BookmarkSearchNode['kind'];
  unusable: boolean;
  children: BookmarkSearchNode[];
}

const unusableBookmark = (node: BookmarkNodeView) =>
  node.kind === 'bookmark' && bookmarkAddressState(node.url) !== 'usable';

interface ConvertTask {
  readonly node: BookmarkNodeView;
  readonly parentId: string;
  readonly index: number;
  /** 该节点应追加到的父级 `children`；显式栈按原顺序填充，避免递归。 */
  readonly sink: BookmarkSearchNode[];
}

/**
 * 视图树 → 搜索树，显式栈迭代（任意深度都不增加调用栈）。
 *
 * 顺序与递归 DFS 完全一致：父节点先于子节点，兄弟按浏览器顺序，根之间保持原序；
 * 隐藏节点连同整棵子树跳过，分隔符保留形状但不展开。整棵树全量投影，不截断。
 */
function convertTree(input: { readonly roots: readonly BookmarkRootView[];
  readonly hidden: ReadonlySet<string> }): BookmarkSearchNode[] {
  const tree: BookmarkSearchNode[] = [];
  const stack: ConvertTask[] = [];
  // 先按原顺序建出全部根（隐藏根整棵跳过），再逐根把子节点逆序压栈。
  const visible: Array<{ root: BookmarkRootView; sink: BookmarkSearchNode[] }> = [];
  for (const [index, root] of input.roots.entries()) {
    if (input.hidden.has(root.nodeId)) continue;
    const draft: SearchNodeDraft = { id: root.nodeId, parentId: null, index, title: root.title,
      url: null, kind: 'root', unusable: false, children: [] };
    tree.push(draft);
    visible.push({ root, sink: draft.children });
  }
  const enqueueChildren = (children: readonly BookmarkNodeView[], parentId: string,
    sink: BookmarkSearchNode[]) => {
    // 逆序压栈：出栈顺序即原始顺序。
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index]!, parentId, index, sink });
    }
  };
  for (let index = visible.length - 1; index >= 0; index -= 1) {
    const { root, sink } = visible[index]!;
    enqueueChildren(root.children, root.nodeId, sink);
  }
  while (stack.length > 0) {
    const task = stack.pop()!;
    if (input.hidden.has(task.node.nodeId)) continue;
    const draft: SearchNodeDraft = { id: task.node.nodeId, parentId: task.parentId, index: task.index,
      title: task.node.title, url: task.node.kind === 'bookmark' ? task.node.url : null,
      kind: task.node.kind, unusable: unusableBookmark(task.node), children: [] };
    task.sink.push(draft);
    // 分隔符只在展示中出现；索引阶段统一跳过，这里同样不展开子节点。
    if (task.node.kind !== 'separator') enqueueChildren(task.node.children, task.node.nodeId, draft.children);
  }
  return tree;
}

/** 返回搜索投影（全量，不截断）；快照本身有效，因此总是返回结构（不可读状态由 `status` 表达）。 */
export function bookmarkSearchProjection(snapshot: BookmarkViewSnapshot): BookmarkSearchProjection {
  return {
    // 隐藏的根连同整棵子树一起离开投影：搜索与渲染共用同一份可见内容。
    tree: convertTree({ roots: snapshot.roots, hidden: hiddenSet(snapshot) }),
    status: SEARCH_STATUS[snapshot.status],
    readAt: snapshot.readAt,
    error: snapshot.error,
  };
}

/** 书签上下文 → 搜索桥的端口形状；由 `bookmarkSearchBridge` 实现，只按节点 ID 定位。 */
export interface BookmarkSearchBridge {
  readonly showInSearch: boolean;
  readonly projection: BookmarkSearchProjection | null;
  readonly openBookmark?: (nodeId: string) => void;
  readonly openBookmarkFolder?: (nodeId: string) => void;
}

/** 只有这些状态说明权限仍有效、内容可读（layout 隐藏区域不影响搜索）。 */
const SEARCHABLE_STATUSES: ReadonlySet<BookmarkViewStatus> = new Set(['ready', 'stale', 'error', 'importing']);
const MISSING_NODE = '书签已不在当前列表';

function bookmarkNodeFor(snapshot: BookmarkViewSnapshot, nodeId: string): BookmarkNodeView | null {
  const stack = [...snapshot.roots].reverse().flatMap((root) => root.children);
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) continue;
    if (node.nodeId === nodeId) return node;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child) stack.push(child);
    }
  }
  return null;
}

/** 根也会被索引成 `bookmark-folder`，定位文件夹时必须把根算进来。 */
function bookmarkContainerExists(snapshot: BookmarkViewSnapshot, nodeId: string): boolean {
  if (snapshot.roots.some((root) => root.nodeId === nodeId)) return true;
  return bookmarkNodeFor(snapshot, nodeId)?.kind === 'folder';
}

/**
 * 书签上下文 → 搜索桥。
 *
 * 关闭功能、撤销权限、API 缺失或首次读取中时同步返回 `null`：调用方立即不产生任何
 * 书签结果，也不保留上一次结果。区域被布局隐藏（`regionVisible === false`）但功能
 * 仍启用时照常提供，符合「布局隐藏不等于关闭功能」。
 *
 * 打开始终按**当前快照**里的节点委托 `context.openBookmark` / `context.openFolder`：
 * 原始地址与打开方式由提供方决定，搜索不接触 `href`、`window.open` 或脚本执行。
 * 节点已从当前投影消失时明确失败，不猜测、不回退到其他节点。
 */
export function bookmarkSearchBridge(
  context: BookmarkContextValue | null | undefined,
): BookmarkSearchBridge | null {
  if (!context) return null;
  const { snapshot } = context;
  if (!snapshot.enabled || snapshot.permission !== 'granted') return null;
  if (!SEARCHABLE_STATUSES.has(snapshot.status)) return null;
  return {
    showInSearch: snapshot.showInSearch,
    projection: bookmarkSearchProjection(snapshot),
    openBookmark: (nodeId) => {
      const node = bookmarkNodeFor(snapshot, nodeId);
      // 根与分隔符不是链接；索引只会把链接生成为 `bookmark`，这里再挡一次防止误委托。
      if (!node || node.kind !== 'bookmark') throw new Error(MISSING_NODE);
      context.openBookmark(node);
    },
    openBookmarkFolder: (nodeId) => {
      if (!bookmarkContainerExists(snapshot, nodeId)) throw new Error(MISSING_NODE);
      context.openFolder(nodeId);
    },
  };
}
