import type { BookmarkHiddenRule, BookmarkMode, BookmarkRuleKind } from '@/domain/bookmark-preferences';

/**
 * 浏览器收藏夹的只读视图契约。
 *
 * 这里只描述 UI 需要的结构，不读取浏览器 API、不构造持久化数据，也不提供来源/根选择。
 * 投影由领域层生成，`src/app/bookmark-context.tsx` 的提供方负责把控制器、偏好与缓存
 * 映射成这些字段；静态预览组件只消费本文件，不伪造收藏夹内容。
 *
 * 顺序约定：
 * - `roots` 按浏览器根顺序；每个节点的 `children` 按浏览器原始顺序，包含分隔符与空文件夹。
 * - `path` 是从浏览器根到该节点的完整标题路径（含根标题与自身标题），标题保持源数据原文。
 *   展示时才对空白做裁剪；空标题由 `bookmarkDisplayName` 回退，不得抛错。
 * - 根直属书签在显示层标注「未分类」，但位置保持浏览器遍历顺序，不集中挪到末尾。
 */
export type BookmarkViewStatus =
  | 'disabled'
  | 'unsupported'
  | 'permission-missing'
  | 'loading'
  | 'ready'
  | 'stale'
  | 'importing'
  | 'error';

export type BookmarkPermissionState = 'granted' | 'denied' | 'unknown';

export type BookmarkNodeKind = 'bookmark' | 'folder' | 'separator';

export interface BookmarkNodeView {
  /** 浏览器节点 ID；只在导航与隐藏规则中使用，不写入 Orinui 自有数据。 */
  readonly nodeId: string;
  readonly kind: BookmarkNodeKind;
  /** 浏览器原始标题，可能为空、含首尾空白或重复。 */
  readonly title: string;
  /** 浏览器原始地址；非书签节点为 null。展示全部协议，不做协议过滤。 */
  readonly url: string | null;
  /** 从浏览器根到本节点的完整标题路径（含自身标题）。 */
  readonly path: readonly string[];
  /** 仅文件夹有内容；按浏览器顺序，可能为空数组。 */
  readonly children: readonly BookmarkNodeView[];
}

export interface BookmarkRootView {
  readonly nodeId: string;
  readonly title: string;
  /** 浏览器根自身的路径，通常只有根标题。 */
  readonly path: readonly string[];
  readonly children: readonly BookmarkNodeView[];
}

/** 隐藏规则可绑定的目标：浏览器根或普通文件夹。 */
export interface BookmarkRuleCandidate {
  readonly nodeId: string;
  readonly path: readonly string[];
  readonly kind: BookmarkRuleKind;
}

/**
 * 待处理规则的当前设备匹配结果。
 *
 * `matched` 时 `nodeId` 是命中的浏览器节点；`ambiguous` 时 `candidates` 是候选清单，
 * 按当前树推导，不落库、不同步。`unmatched` 不猜测目标，也不删除规则。
 */
export interface BookmarkRuleMatch {
  readonly ruleId: string;
  readonly status: 'matched' | 'ambiguous' | 'unmatched';
  readonly nodeId: string | null;
  readonly candidates: readonly BookmarkRuleCandidate[];
}

/** 搜索或外部入口请求打开某个浏览器文件夹；UI 按 `requestId` 只消费一次。 */
export interface BookmarkFolderRequest {
  readonly requestId: number;
  readonly nodeId: string;
}

/**
 * 设置、主页区域与搜索共用的只读快照。
 *
 * `hiddenRules` 是偏好本体；`hiddenNodeIds` 与 `ruleMatches` 是当前设备按本次树推导的
 * 内存结果，不持久化。`actionError` 是最近一次用户操作失败原因，和读取错误分开显示。
 */
export interface BookmarkViewSnapshot {
  readonly status: BookmarkViewStatus;
  readonly permission: BookmarkPermissionState;
  /** 用户的跨设备启用意图；本机实际读取还需 `permission === 'granted'`。 */
  readonly enabled: boolean;
  readonly mode: BookmarkMode;
  readonly showInSearch: boolean;
  /** 由布局隐藏状态派生；隐藏区域不影响搜索。 */
  readonly regionVisible: boolean;
  readonly roots: readonly BookmarkRootView[];
  readonly hiddenRules: readonly BookmarkHiddenRule[];
  readonly hiddenNodeIds: readonly string[];
  readonly ruleMatches: readonly BookmarkRuleMatch[];
  readonly error: string | null;
  readonly actionError: string | null;
  /** 上一次成功读取的时间；只在权限有效且确实读取过时有值。 */
  readonly readAt: number | null;
  readonly busy: boolean;
  readonly folderRequest: BookmarkFolderRequest | null;
}

/**
 * UI 可调用的窄动作集合。
 *
 * 所有动作都是同步入口：提供方在用户手势调用链内自行启动异步任务，并把进度/错误
 * 写回快照。`requestEnable` 必须在点击事件内直接调用，权限请求不得延后到 effect 或
 * 其他 await 之后。
 */
export interface BookmarkContextValue {
  readonly snapshot: BookmarkViewSnapshot;
  requestEnable(): void;
  disable(): void;
  retry(): void;
  updateMode(mode: BookmarkMode): void;
  updateSearch(showInSearch: boolean): void;
  setRegionVisible(visible: boolean): void;
  /**
   * 隐藏或恢复一个浏览器根/文件夹。
   *
   * 第三个参数是要更新的规则：可以传单条 `ruleId`，也可以传该节点**全部**命中的
   * 隐藏规则 ID。同一节点可能被跨设备合并出多条 `hidden: true` 规则，而领域层对
   * 任一 `true` 规则都会隐藏节点，因此恢复显示必须一次性提交全部命中的规则，
   * 逐条 `false` 只取消它自己。不传则按目标新建。
   *
   * 提供方保证一次调用内逐条独立写入；不要为了多规则而循环调用（会被忙锁吞掉）。
   */
  setHidden(target: BookmarkRuleCandidate, hidden: boolean, ruleId?: string | readonly string[]): void;
  /** 把待处理规则绑定到用户明确选择的节点；使用规则自身的 `ruleId`。 */
  bindRule(ruleId: string, target: BookmarkRuleCandidate): void;
  deleteRule(ruleId: string): void;
  clearCache(): void;
  openBookmark(node: BookmarkNodeView): void;
  /** 请求打开文件夹；导航 UI 同时保留本地状态，外部入口可经 `folderRequest` 传入。 */
  openFolder(nodeId: string): void;
}

function pathSegments(segments: readonly string[]): string[] {
  const trimmed = segments.map((segment) => segment.trim()).filter((segment) => segment !== '');
  return trimmed.length > 0 ? trimmed : ['路径未知'];
}

/** 显示用路径；只裁剪首尾空白，不改写标题内容。 */
export function bookmarkPathText(segments: readonly string[]): string {
  return pathSegments(segments).join(' / ');
}

/** 空标题按节点种类回退，保证导航与管理器都不会因空字符串崩溃。 */
export function bookmarkDisplayName(node: Pick<BookmarkNodeView, 'title' | 'url' | 'kind'>): string {
  const title = node.title.trim();
  if (title !== '') return title;
  if (node.kind === 'folder') return '未命名文件夹';
  if (node.kind === 'separator') return '分隔线';
  const url = node.url?.trim() ?? '';
  return url === '' ? '未命名书签' : url;
}

export function bookmarkKindLabel(kind: BookmarkNodeKind): string {
  if (kind === 'folder') return '文件夹';
  if (kind === 'separator') return '分隔线';
  return '书签';
}

export type BookmarkAddressState = 'usable' | 'missing' | 'malformed';

/**
 * 地址是否可交给浏览器尝试。
 *
 * 只判断「有协议前缀」，不按协议白名单过滤：`javascript:`、`data:`、`chrome://` 等
 * 仍按浏览器原文显示，打开只委托平台导航。空串与缺少协议的串明确标为不可用。
 */
export function bookmarkAddressState(url: string | null): BookmarkAddressState {
  const value = url?.trim() ?? '';
  if (value === '') return 'missing';
  return /^[a-z][a-z0-9+.-]*:/i.test(value) ? 'usable' : 'malformed';
}

/** 列表行副标题：完整路径（含自身标题），两种模式与设置管理器保持一致。 */
export function bookmarkRowMeta(node: BookmarkNodeView): string {
  return bookmarkPathText(node.path);
}

/** 根直属书签在显示层归入「未分类」分组，但位置仍保持浏览器遍历顺序。 */
export function bookmarkIsRootDirect(node: Pick<BookmarkNodeView, 'kind' | 'path'>): boolean {
  return node.kind === 'bookmark' && node.path.length === 2;
}

/** 只有带协议前缀的地址才交给浏览器尝试；缺失或不完整的保持可见但不可打开。 */
export function bookmarkCanOpen(node: Pick<BookmarkNodeView, 'kind' | 'url'>): boolean {
  if (node.kind === 'separator') return false;
  if (node.kind === 'folder') return true;
  return bookmarkAddressState(node.url) === 'usable';
}

/** React key 同时带节点 ID 与路径，避免重复标题或异常重复 ID 造成同键。 */
export function bookmarkNodeKey(node: BookmarkNodeView): string {
  return `${node.nodeId}\u0000${node.path.join('\u0000')}`;
}

export function bookmarkInitial(name: string): string {
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(name)[Symbol.iterator]().next();
  return first.done ? '?' : first.value.segment.toLocaleUpperCase();
}

export function bookmarkReadAtLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '尚未读取';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

export function findBookmarkNode(
  roots: readonly BookmarkRootView[],
  nodeId: string,
): BookmarkNodeView | null {
  const stack = [...roots].reverse().flatMap((root) => root.children);
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

/** 从浏览器根的直接子项到目标节点的链条；找不到时返回空数组。 */
export function findBookmarkTrail(
  roots: readonly BookmarkRootView[],
  nodeId: string,
): BookmarkNodeView[] {
  const stack: Array<{ node: BookmarkNodeView; trail: BookmarkNodeView[] }> = [];
  for (let rootIndex = roots.length - 1; rootIndex >= 0; rootIndex -= 1) {
    const root = roots[rootIndex];
    if (!root) continue;
    for (let index = root.children.length - 1; index >= 0; index -= 1) {
      const child = root.children[index];
      if (child) stack.push({ node: child, trail: [child] });
    }
  }
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.node.nodeId === nodeId) return current.trail;
    for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
      const child = current.node.children[index];
      if (child) stack.push({ node: child, trail: [...current.trail, child] });
    }
  }
  return [];
}

/** 文件夹模式的初始格：全部浏览器根的直接子项，不显示内部虚拟根。 */
export function bookmarkInitialEntries(roots: readonly BookmarkRootView[]): BookmarkNodeView[] {
  return roots.flatMap((root) => root.children);
}

/**
 * 区域视图中一个浏览器根的子项分段。
 *
 * 根直属链接（以及夹在它们中间的分隔符）合并为一段「未分类」；文件夹与孤立的
 * 分隔符各自成段。分段只做连续包裹，**不改变浏览器返回的相对顺序**，
 * 也不会让链接跨过原文件夹或分隔符。
 */
export type BookmarkChildSegment =
  | { readonly kind: 'uncategorized'; readonly key: string; readonly entries: readonly BookmarkNodeView[] }
  | { readonly kind: 'node'; readonly key: string; readonly node: BookmarkNodeView };

/** 把某个容器的子项切成「未分类连续段 + 其他单节点」，保持原顺序。 */
export function bookmarkChildSegments(
  children: readonly BookmarkNodeView[],
): readonly BookmarkChildSegment[] {
  const segments: BookmarkChildSegment[] = [];
  let run: BookmarkNodeView[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const entries = run;
    run = [];
    segments.push({ kind: 'uncategorized', key: `uncategorized:${bookmarkNodeKey(entries[0] as BookmarkNodeView)}`, entries });
  };
  for (const node of children) {
    if (node.kind === 'bookmark' && bookmarkIsRootDirect(node)) {
      run.push(node);
      continue;
    }
    if (node.kind === 'separator' && run.length > 0) {
      run.push(node);
      continue;
    }
    flush();
    segments.push({ kind: 'node', key: bookmarkNodeKey(node), node });
  }
  flush();
  return segments;
}

/**
 * 待确认的隐藏规则数量（区域状态行使用）。
 *
 * 只按本次快照的匹配结果派生：`matched` 且命中节点的规则已生效，其余（路径歧义、
 * 无匹配、缺少候选）都计入待确认。结果只在内存计算，不写回规则、不落库。
 */
export function bookmarkPendingRuleCount(
  rules: readonly BookmarkHiddenRule[],
  matches: readonly BookmarkRuleMatch[],
): number {
  return rules.filter((rule) => {
    const match = matches.find((entry) => entry.ruleId === rule.ruleId);
    return match?.status !== 'matched' || !match.nodeId;
  }).length;
}

/** 区域视图的返回键：非输入态、无修饰键的 Esc 或 Backspace 才生效。 */
export function bookmarkBackShortcutKey(input: {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isEditable: boolean;
}): boolean {
  if (input.isEditable) return false;
  if (input.altKey || input.ctrlKey || input.metaKey || input.shiftKey) return false;
  return input.key === 'Escape' || input.key === 'Backspace';
}

/** 焦点是否位于输入控件或可编辑区域；是则不劫持 Esc/Backspace。 */
export function bookmarkIsEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.closest !== 'function') return false;
  return element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
}

/**
 * 区域视图按返回键时要收起的父文件夹（最近可确认的父层）。
 *
 * `trail` 是从浏览器根的直接子项到当前焦点节点的链条；父层不是文件夹（即当前节点是
 * 根直属条目）或已在顶层时返回 `null`，不做任何导航。
 */
export function bookmarkParentFolderId(trail: readonly BookmarkNodeView[]): string | null {
  const parent = trail.length >= 2 ? trail[trail.length - 2] : undefined;
  return parent && parent.kind === 'folder' ? parent.nodeId : null;
}
