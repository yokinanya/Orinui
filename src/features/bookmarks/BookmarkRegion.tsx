import { BookmarkIcon, FolderIcon, RotateCwIcon, ShieldAlertIcon, TriangleAlertIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  bookmarkAddressState, bookmarkBackShortcutKey, bookmarkCanOpen, bookmarkChildSegments, bookmarkDisplayName,
  bookmarkInitial, bookmarkIsEditableTarget, bookmarkNodeKey, bookmarkParentFolderId, bookmarkPathText,
  bookmarkPendingRuleCount, bookmarkReadAtLabel, findBookmarkTrail,
  type BookmarkContextValue, type BookmarkNodeView,
} from '@/features/bookmarks/bookmark-view';
import { BookmarkFolderDialog, emptyLayerKind, locate } from '@/features/bookmarks/BookmarkFolderDialog';
import { BookmarkManagerGuidanceDisclosure } from '@/features/bookmarks/BookmarkManagerGuidance';
import { BookmarkRow, BookmarkSeparatorRow } from '@/features/bookmarks/BookmarkRow';

const REGION_TITLE = '浏览器收藏夹';

function RegionHeader({ statusLabel }: { readonly statusLabel?: string }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="home-readable-ink m-0 text-base font-medium">{REGION_TITLE}</h2>
        <span className="home-readable-muted border-l border-glass-border pl-2.5 text-xs">浏览器拥有 · 只读</span>
      </div>
      <span className="home-readable-muted text-xs">{statusLabel ?? '原始顺序 · 保留重复'}</span>
    </header>
  );
}

function RegionFooter() {
  return (
    <div className="flex flex-col gap-2 border-t border-glass-border/60 pt-3">
      <p className="home-readable-muted m-0 flex items-start gap-1.5 text-xs">
        <BookmarkIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
        路径与顺序由浏览器提供；Orinui 不修改、不抓取图标。隐藏根或文件夹请在设置 → 收藏夹中操作。
      </p>
      <BookmarkManagerGuidanceDisclosure tone="home" />
    </div>
  );
}

function LoadingRegion() {
  return (
    <section aria-label={REGION_TITLE} className="flex w-full min-w-0 flex-col gap-4">
      <RegionHeader statusLabel="正在读取" />
      <div role="status" aria-label="正在读取本机浏览器收藏夹" className="flex flex-col gap-3" style={{ minHeight: '11rem' }}>
        {[0, 1].map((index) => (
          <div key={index} aria-hidden="true" className="flex items-center gap-3 rounded-xl border border-glass-border/50 bg-glass/30 p-3">
            <Skeleton className="size-12 shrink-0 rounded-2xl" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-1/2 rounded-full" />
              <Skeleton className="h-2.5 w-2/3 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function NoticeCard({ title, description, children }: {
  readonly title: string;
  readonly description: string;
  readonly children?: React.ReactNode;
}) {
  return (
    <section aria-label={REGION_TITLE} className="flex w-full min-w-0 flex-col gap-4">
      <RegionHeader />
      <div className="flex flex-col items-start gap-2 rounded-xl border border-glass-border/60 bg-glass/35 p-4">
        <p className="home-readable-ink m-0 text-sm font-medium">{title}</p>
        <p className="home-readable-muted m-0 text-xs">{description}</p>
        {children}
      </div>
    </section>
  );
}

/**
 * 主页「浏览器收藏夹」区域。
 *
 * - 没有提供方或功能关闭：不渲染任何节点（区域缺失，不显示空列表）。
 * - 未授权：只显示重新授权入口，不显示任何标题。
 * - API 缺失：明确说明当前浏览器不提供接口，不是空收藏夹。
 * - 读取中：固定高度骨架，不用缓存抢占首屏。
 * - 读取失败：`role="alert"` 常驻错误与重试；权限有效且有上次结果时才进入 stale。
 * - 区域模式：固定标题下按全部浏览器根分组，逐层就地展开；默认展开，折叠只影响本机。
 * - 文件夹模式：全部浏览器根的直接子项的只读网格，进入后逐层浏览。
 */
export function BookmarkRegion({ bookmarks }: { readonly bookmarks: BookmarkContextValue }) {
  const { snapshot } = bookmarks;
  if (snapshot.status === 'disabled') return null;

  if (snapshot.status === 'unsupported') {
    return (
      <NoticeCard title="无法在当前浏览器启用收藏夹"
        description="此浏览器没有提供书签接口；这不是空收藏夹，也没有可重试的读取操作。请在提供书签接口的 Chrome 或 Firefox 中使用。">
        <BookmarkManagerGuidanceDisclosure tone="home" />
      </NoticeCard>
    );
  }

  if (snapshot.status === 'permission-missing' || snapshot.permission === 'denied') {
    return (
      <NoticeCard title="需要重新允许读取收藏夹"
        description="权限被撤销或此设备尚未授权。只读标题、地址与层级；不修改、不上传，也不显示任何上次读取的书签标题。">
        <Button type="button" size="sm" onClick={() => bookmarks.requestEnable()} className="home-readable-focus">
          请求收藏夹权限
        </Button>
        <span className="home-readable-muted text-xs">授权后才会读取；拒绝则保持关闭。</span>
      </NoticeCard>
    );
  }

  if (snapshot.status === 'loading') return <LoadingRegion />;

  const stale = snapshot.status === 'stale';

  if (snapshot.status === 'error') {
    return (
      <section aria-label={REGION_TITLE} className="flex w-full min-w-0 flex-col gap-4">
        <RegionHeader statusLabel="读取失败" />
        <div role="alert" className="flex flex-col items-start gap-2 rounded-xl border border-destructive/30 bg-glass/35 p-4">
          <p className="home-readable-ink m-0 flex items-center gap-1.5 text-sm font-medium">
            <TriangleAlertIcon aria-hidden="true" className="size-4 text-destructive" />
            暂时读不到浏览器收藏夹
          </p>
          <p className="home-readable-muted m-0 text-xs">{snapshot.error ?? '本机没有可用的上次读取结果，请重试。'}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => bookmarks.retry()} className="home-readable-focus">
            <RotateCwIcon aria-hidden="true" />
            重新读取
          </Button>
          <BookmarkManagerGuidanceDisclosure tone="home" />
        </div>
      </section>
    );
  }

  const folderMode = snapshot.mode === 'folder';

  return (
    <section aria-label={REGION_TITLE} data-bookmark-region className="flex w-full min-w-0 flex-col gap-4">
      <RegionHeader statusLabel={folderMode ? '全部浏览器根的直接子项' : undefined} />
      {snapshot.status === 'importing' && (
        <p role="status" className="home-readable-muted m-0 text-xs">浏览器正在导入收藏夹，完成后会一次性显示。</p>
      )}
      {stale && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-xs">
          <ShieldAlertIcon aria-hidden="true" className="size-4 text-amber-700 dark:text-amber-300" />
          <strong className="font-medium">上次读取：{bookmarkReadAtLabel(snapshot.readAt)}</strong>
          <span className="text-muted-foreground">{snapshot.error ?? '本次读取失败，以下内容可能已过期。'}</span>
          <Button type="button" size="xs" variant="outline" className="ml-auto" onClick={() => bookmarks.retry()}>
            <RotateCwIcon aria-hidden="true" />
            重试
          </Button>
        </div>
      )}
      {snapshot.actionError && <p role="alert" className="m-0 text-xs text-destructive">{snapshot.actionError}</p>}
      {/* 待确认规则提示属于区域级状态，两种模式都显示，且只渲染一次。 */}
      <PendingRulesNotice
        count={bookmarkPendingRuleCount(snapshot.hiddenRules, snapshot.ruleMatches)} />
      {folderMode
        ? <FolderGridMode bookmarks={bookmarks} stale={stale} />
        : <RegionTreeMode bookmarks={bookmarks} stale={stale} />}
      <RegionFooter />
    </section>
  );
}

/**
 * 区域视图要渲染的一条行。
 *
 * `depth` 用于原始缩进；`expanded` 表示文件夹当前是否展开（折叠状态只在本机内存）。
 */
export interface RegionRow {
  readonly node: BookmarkNodeView;
  readonly depth: number;
  readonly expanded: boolean;
  readonly showEmptyNote: boolean;
}

/**
 * 把一棵浏览器子树摊平成按显示顺序排列的行。
 *
 * 显式栈 DFS，**不使用函数自身递归**：5000 层合法树也不会爆调用栈。
 * 只按隐藏集合过滤与折叠状态展开，保留原顺序、分隔符、书签与空文件夹；
 * 不做任何深度或条目上限截断。
 */
export function collectRegionEntries(input: {
  readonly nodes: readonly BookmarkNodeView[];
  readonly hidden: ReadonlySet<string>;
  readonly collapsed: ReadonlySet<string>;
}): RegionRow[] {
  const rows: RegionRow[] = [];
  type Task = { readonly node: BookmarkNodeView; readonly depth: number };
  const stack: Task[] = [];
  for (let index = input.nodes.length - 1; index >= 0; index -= 1) {
    const node = input.nodes[index];
    if (node && !input.hidden.has(node.nodeId)) stack.push({ node, depth: 0 });
  }
  while (stack.length > 0) {
    const task = stack.pop();
    if (!task) continue;
    const { node, depth } = task;
    const expanded = node.kind === 'folder' && !input.collapsed.has(node.nodeId);
    rows.push({
      node,
      depth,
      expanded,
      showEmptyNote: expanded && node.children.length === 0,
    });
    if (!expanded) continue;
    // 逆序压栈，弹出时仍是浏览器原始顺序。
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index];
      if (child && !input.hidden.has(child.nodeId)) stack.push({ node: child, depth: depth + 1 });
    }
  }
  return rows;
}

/**
 * 由扁平行构建与逐层递归完全相同的嵌套 React 元素。
 *
 * 逆序单遍组装：子元素先于父元素建好，用 `layers[depth]` 收集该层已完成的节点，
 * 因此父级能拿到自己的子元素，而不需要递归调用渲染函数。
 *
 * `layers.length = row.depth + 1` 是防御性约束：取走子层后丢弃更深的残留层，
 * 保证同层兄弟绝不会看到上一棵子树的节点（preorder 下本就不会残留，
 * 但这样即使输入顺序异常也不会串层）。
 */
export function buildRegionNodes(
  rows: readonly RegionRow[],
  render: (row: RegionRow, children: readonly React.ReactNode[]) => React.ReactNode,
): React.ReactNode[] {
  const layers: React.ReactNode[][] = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (!row) continue;
    const childLayer = layers[row.depth + 1] ?? [];
    layers.length = row.depth + 1;
    const own = layers[row.depth] ?? [];
    own.push(render(row, childLayer.toReversed()));
    layers[row.depth] = own;
  }
  return (layers[0] ?? []).toReversed();
}

function PendingRulesNotice({ count }: { readonly count: number }) {
  if (count <= 0) return null;
  return (
    <p role="status" className="home-readable-muted m-0 rounded-xl border border-amber-600/30 bg-amber-500/10 px-3 py-2 text-xs">
      {count} 条隐藏规则待确认（路径歧义或无匹配）。规则仍保留，但不会隐藏任何内容；
      可在设置「浏览器收藏夹 → 完整收藏夹树与隐藏规则」中绑定目标或删除。
    </p>
  );
}

function RootHeading({ title, path }: { readonly title: string; readonly path: readonly string[] }) {
  const pathText = bookmarkPathText(path);
  return (
    <header className="flex min-w-0 flex-col gap-0.5">
      <h3 className="home-readable-ink m-0 truncate text-sm font-medium">{title.trim() || '未命名收藏夹根'}</h3>
      <p className="home-readable-muted m-0 truncate text-xs" title={pathText}>{pathText}</p>
    </header>
  );
}

function EmptyRoot({ hidden }: { readonly hidden: boolean }) {
  return (
    <p className="home-readable-muted m-0 py-2 text-xs">
      {hidden
        ? '此根下的条目都被隐藏规则覆盖。可在设置「浏览器收藏夹 → 完整收藏夹树与隐藏规则」中恢复显示。'
        : '此根没有可显示的内容。'}
    </p>
  );
}

function RegionTreeMode({ bookmarks, stale }: {
  readonly bookmarks: BookmarkContextValue;
  readonly stale: boolean;
}) {
  const { snapshot } = bookmarks;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const hidden = useMemo(() => new Set(snapshot.hiddenNodeIds), [snapshot.hiddenNodeIds]);

  // 外部搜索请求由 `BookmarkFolderHost` 唯一消费，区域内不再重复展开/打开，
  // 避免同一 requestId 同时触发区域展开与外部弹层。

  const toggle = (nodeId: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(nodeId)) next.delete(nodeId); else next.add(nodeId);
    return next;
  });

  /**
   * 区域视图的返回：Esc / Backspace 在非输入态收起最近可确认的父层，
   * 并把焦点交给该层标题，避免焦点落在已隐藏的子树里。
   * 输入框、文本框、组合键（Alt/Ctrl/Meta/Shift）与输入法组合中一律不劫持。
   */
  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (!bookmarkBackShortcutKey({
      key: event.key,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      isEditable: bookmarkIsEditableTarget(event.target),
    })) return;

    const focused = (event.target as HTMLElement | null)?.closest?.('[data-bookmark-node-id]');
    const focusedId = focused?.getAttribute('data-bookmark-node-id') ?? null;
    if (!focusedId) return;
    const trail = findBookmarkTrail(snapshot.roots, focusedId);
    if (trail.length === 0) return;

    const self = trail[trail.length - 1];
    // 当前是展开的文件夹时先收起自己（等价于「返回上一级」）。
    const targetId = self && self.kind === 'folder' && !collapsed.has(self.nodeId)
      ? self.nodeId
      : bookmarkParentFolderId(trail);
    if (!targetId) return;

    event.preventDefault();
    setCollapsed((current) => {
      const next = new Set(current);
      next.add(targetId);
      return next;
    });
    // 目标行仍在 DOM 中（收起只影响其后代），可以立即转移焦点。
    const target = event.currentTarget.querySelector<HTMLElement>(`[data-bookmark-node-id="${CSS.escape(targetId)}"]`);
    target?.focus();
  };

  const rootSections = snapshot.roots.filter((root) => !hidden.has(root.nodeId));

  if (snapshot.roots.length === 0) {
    return <p className="home-readable-muted m-0 rounded-xl border border-glass-border/60 bg-glass/30 p-4 text-sm">
      浏览器里还没有可显示的收藏夹。可先在浏览器中添加；这里不会提供新建入口。
    </p>;
  }

  if (rootSections.length === 0) {
    return (
      <div className="flex w-full min-w-0 flex-col gap-1.5 rounded-xl border border-glass-border/60 bg-glass/30 p-4">
        <p className="home-readable-ink m-0 text-sm font-medium">全部浏览器根都已隐藏</p>
        <p className="home-readable-muted m-0 text-xs">
          收藏夹本身仍然存在，只是被隐藏规则覆盖。可在设置「浏览器收藏夹 → 完整收藏夹树与隐藏规则」中恢复显示；
          这里不会隐藏单条链接，也不会修改浏览器书签。
        </p>
      </div>
    );
  }

  /**
   * 渲染一棵子树。
   *
   * 扁平行由 `collectRegionEntries` 迭代展平，再由 `buildRegionNodes` 逆序组装成
   * 与逐层递归**完全相同**的嵌套结构（同样的 div/缩进/竖线/空文件夹提示），
   * 但渲染函数本身不再逐层调用自己，深层树不会爆调用栈。
   */
  const renderTree = (nodes: readonly BookmarkNodeView[]): React.ReactNode[] => {
    const rows = collectRegionEntries({ nodes, hidden, collapsed });
    return buildRegionNodes(rows, (row, children) => {
      const key = bookmarkNodeKey(row.node);
      if (row.node.kind === 'separator') return <BookmarkSeparatorRow key={`sep:${key}`} />;
      return (
        <div key={key} className="flex min-w-0 flex-col">
          <BookmarkRow node={row.node} stale={stale} expanded={row.expanded} depth={row.depth}
            onActivate={(target) => {
              if (target.kind === 'folder') { toggle(target.nodeId); return; }
              if (target.kind === 'bookmark') bookmarks.openBookmark(target);
            }} />
          {row.expanded && row.node.children.length > 0 && (
            <div className="ml-6 flex flex-col border-l border-glass-border/50 pl-2">
              {children}
            </div>
          )}
          {row.showEmptyNote && (
            <p className="home-readable-muted m-0 ml-14 py-1 text-xs">此文件夹为空</p>
          )}
        </div>
      );
    });
  };

  /** 根直属链接按连续段归入「未分类」，不重排、不跨过文件夹或分隔符。 */
  const renderRootChildren = (root: { readonly path: readonly string[]; readonly children: readonly BookmarkNodeView[] }) =>
    bookmarkChildSegments(root.children.filter((node) => !hidden.has(node.nodeId)))
      .map((segment) => {
        if (segment.kind === 'node') return renderTree([segment.node]);
        return (
          <div key={segment.key} className="flex min-w-0 flex-col gap-0.5"
            role="group" aria-label={`未分类，${bookmarkPathText(root.path)}`}>
            <p className="home-readable-muted m-0 px-2 pt-1 text-[11px] font-medium">未分类 · {bookmarkPathText(root.path)}</p>
            {renderTree(segment.entries)}
          </div>
        );
      });

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2" aria-label="浏览器收藏夹分组"
      onKeyDown={handleTreeKeyDown}>
      {/* 被隐藏的根连同后代完全不出现，也不留占位或「已隐藏」提示。 */}
      {rootSections.map((root) => {
        const key = `${root.nodeId}\u0000${root.path.join('\u0000')}`;
        const visibleChildren = root.children.filter((node) => !hidden.has(node.nodeId));
        return (
          <section key={key} aria-label={`${bookmarkPathText(root.path)} 分组`}
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-glass-border/60 bg-glass/30 p-3">
            <RootHeading title={root.title} path={root.path} />
            {visibleChildren.length === 0
              ? <EmptyRoot hidden={root.children.length > 0} />
              : <div className="flex flex-col gap-0.5">{renderRootChildren(root)}</div>}
          </section>
        );
      })}
    </div>
  );
}

function FolderGridMode({ bookmarks, stale }: {
  readonly bookmarks: BookmarkContextValue;
  readonly stale: boolean;
}) {
  const { snapshot } = bookmarks;
  const [openFolderId, setOpenFolderId] = useState<string | null>(null);
  const hidden = useMemo(() => new Set(snapshot.hiddenNodeIds), [snapshot.hiddenNodeIds]);

  // 外部搜索请求由 `BookmarkFolderHost` 唯一消费（区域被布局隐藏时也要能打开）。
  // 区域内只处理本地点击，避免同一请求打开两个弹层。

  // 隐藏根会连同其全部后代一起消失，文件夹模式也不得展示其子项。
  const entries = snapshot.roots
    .filter((root) => !hidden.has(root.nodeId))
    .flatMap((root) => root.children)
    .filter((node) => !hidden.has(node.nodeId));
  const hasEntries = entries.some((node) => node.kind !== 'separator');

  if (!hasEntries) {
    const visibleRoots = snapshot.roots.filter((root) => !hidden.has(root.nodeId));
    // 顶层「无可显示条目」的原因与弹层同源：只有原本有内容被隐藏才算隐藏致空，
    // 隐藏本来就空的根、或根下只有分隔符，都仍按真空处理。
    const topLayerEmptyKind = emptyLayerKind(locate(snapshot.roots, null), snapshot.roots, hidden);
    if (snapshot.roots.length > 0 && visibleRoots.length === 0 && topLayerEmptyKind === 'hidden') {
      return (
        <div className="flex w-full min-w-0 flex-col gap-1.5 rounded-xl border border-glass-border/60 bg-glass/30 p-4">
          <p className="home-readable-ink m-0 text-sm font-medium">全部浏览器根都已隐藏</p>
          <p className="home-readable-muted m-0 text-xs">
            收藏夹本身仍然存在，只是被隐藏规则覆盖。可在设置「浏览器收藏夹 → 完整收藏夹树与隐藏规则」中恢复显示。
          </p>
        </div>
      );
    }
    if (snapshot.roots.length === 0) {
      return <p className="home-readable-muted m-0 rounded-xl border border-glass-border/60 bg-glass/30 p-4 text-sm">
        {'浏览器里还没有可显示的收藏夹。可先在浏览器中添加；这里不会提供新建入口。'}
      </p>;
    }
    if (topLayerEmptyKind === 'hidden') {
      return <p className="home-readable-muted m-0 rounded-xl border border-glass-border/60 bg-glass/30 p-4 text-sm">
        {'当前所有条目都被隐藏规则覆盖。可在设置「浏览器收藏夹 → 完整收藏夹树与隐藏规则」中恢复显示。'}
      </p>;
    }
    return <p className="home-readable-muted m-0 rounded-xl border border-glass-border/60 bg-glass/30 p-4 text-sm">
      {'浏览器收藏夹里没有可显示的条目。可先在浏览器中添加；这里不会提供新建入口。'}
    </p>;
  }

  return (
    <>
      <div aria-label="浏览器收藏夹根的直接子项" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {entries.map((node) => {
          const key = `${node.nodeId}\u0000${node.path.join('\u0000')}`;
          if (node.kind === 'separator') return <div key={`sep:${key}`} className="sm:col-span-2"><BookmarkSeparatorRow /></div>;
          const name = bookmarkDisplayName(node);
          const unusable = node.kind === 'bookmark' && !bookmarkCanOpen(node);
          return (
            <button key={key} type="button"
              aria-label={`${name}，${node.kind === 'folder' ? '文件夹' : '书签'}，${bookmarkPathText(node.path)}${unusable ? '，地址不可用' : ''}`}
              aria-haspopup={node.kind === 'folder' ? 'dialog' : undefined}
              aria-disabled={unusable || undefined}
              onClick={() => {
                if (unusable) return;
                if (node.kind === 'folder') { setOpenFolderId(node.nodeId); return; }
                bookmarks.openBookmark(node);
              }}
              className="home-readable-focus group flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl border border-glass-border/60 bg-glass/40 p-2 text-left transition-colors outline-none hover:bg-glass/70">
              <span aria-hidden="true" className="home-readable-surface flex size-12 shrink-0 items-center justify-center rounded-2xl border border-glass-border/60 bg-glass font-medium text-glass-foreground shadow-sm">
                {node.kind === 'folder'
                  ? <FolderIcon className="size-5" />
                  : <span className="text-base leading-none">{bookmarkInitial(name)}</span>}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="home-readable-ink block truncate text-sm">{name}</span>
                <span className="home-readable-muted flex min-w-0 items-center gap-1.5 text-xs">
                  {/* 与行式条目同一 badge/class；只有 stale 才出现，ready 不标。 */}
                  {stale && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-800 dark:text-amber-300">上次读取</span>}
                  <span className="truncate" title={bookmarkPathText(node.path)}>
                    {bookmarkPathText(node.path)}
                  </span>
                </span>
                {unusable && (
                  <span className="text-xs font-medium text-destructive">
                    {bookmarkAddressState(node.url) === 'missing' ? '地址缺失 · 无法打开' : '地址不完整 · 无法打开'}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <BookmarkFolderDialog
        bookmarks={bookmarks}
        open={openFolderId !== null}
        initialFolderId={openFolderId}
        onOpenChange={(open) => { if (!open) setOpenFolderId(null); }}
      />
    </>
  );
}
