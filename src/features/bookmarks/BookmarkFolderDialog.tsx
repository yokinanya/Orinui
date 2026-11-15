import { ArrowLeftIcon, ChevronRightIcon, FolderIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogTitle, FloatingDialogContent } from '@/components/ui/dialog';
import {
  bookmarkDisplayName, bookmarkNodeKey, bookmarkPathText, bookmarkReadAtLabel,
  type BookmarkContextValue, type BookmarkNodeView, type BookmarkRootView,
} from '@/features/bookmarks/bookmark-view';
import { BookmarkManagerGuidance } from '@/features/bookmarks/BookmarkManagerGuidance';
import { BookmarkRow, BookmarkSeparatorRow } from '@/features/bookmarks/BookmarkRow';

interface TrailEntry {
  readonly nodeId: string | null;
  readonly label: string;
}

export interface BookmarkFolderLocation {
  readonly node: BookmarkNodeView | null;
  readonly root: BookmarkRootView | null;
  readonly trail: readonly TrailEntry[];
  /**
   * 请求的节点在当前树里不可达（已删除、被隐藏，或被隐藏的祖先覆盖）。
   * 此时安全回退到「全部收藏夹」层：只显示全部根的直接子项，不猜测目标层。
   */
  readonly missing: boolean;
}

type Location = BookmarkFolderLocation;

const ALL_LABEL = '全部收藏夹';

function allRootsLocation(missing = false): Location {
  return { node: null, root: null, trail: [{ nodeId: null, label: ALL_LABEL }], missing };
}

/**
 * 把导航目标定位到「全部收藏夹」/某个浏览器根/某个文件夹。
 *
 * 根与普通文件夹都是合法目标：面包屑、返回按钮与搜索的 `bookmark-folder` 结果都会传入
 * 根节点 ID，因此必须先按 `root.nodeId` 比较，再在根内部逐层查找，否则根会被误判为
 * 不可达并回退到全部根。被隐藏的根/文件夹（以及被隐藏祖先覆盖的后代）视为不可达，
 * 不显示其内容，也不猜测替代目标。
 */
export function locate(
  roots: readonly BookmarkRootView[],
  nodeId: string | null,
  hidden: ReadonlySet<string> = new Set<string>(),
): Location {
  if (nodeId === null) return allRootsLocation();

  const targetRoot = roots.find((entry) => entry.nodeId === nodeId);
  if (targetRoot) {
    if (hidden.has(targetRoot.nodeId)) return allRootsLocation(true);
    return {
      node: null,
      root: targetRoot,
      trail: [
        { nodeId: null, label: ALL_LABEL },
        { nodeId: targetRoot.nodeId, label: targetRoot.title },
      ],
      missing: false,
    };
  }

  const stack: Array<{ node: BookmarkNodeView; root: BookmarkRootView; ancestors: BookmarkNodeView[] }> = [];
  for (const root of roots) {
    // 隐藏根的整棵子树都不可达，不进入遍历。
    if (hidden.has(root.nodeId)) continue;
    for (const child of root.children) {
      if (hidden.has(child.nodeId)) continue;
      stack.push({ node: child, root, ancestors: [] });
    }
  }
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    if (current.node.nodeId === nodeId) {
      const chain = [...current.ancestors, current.node];
      return {
        node: current.node,
        root: current.root,
        trail: [
          { nodeId: null, label: ALL_LABEL },
          { nodeId: current.root.nodeId, label: current.root.title },
          ...chain.map((entry) => ({ nodeId: entry.nodeId, label: bookmarkDisplayName(entry) })),
        ],
        missing: false,
      };
    }
    for (const child of current.node.children) {
      // 隐藏文件夹的后代不可达。
      if (hidden.has(child.nodeId)) continue;
      stack.push({ node: child, root: current.root, ancestors: [...current.ancestors, current.node] });
    }
  }
  return allRootsLocation(true);
}

/** 当前层可见条目：只来自目标容器本身，保持浏览器顺序与分隔符/空文件夹。 */
export function entriesFor(location: Location, roots: readonly BookmarkRootView[], hidden: ReadonlySet<string>): BookmarkNodeView[] {
  if (location.node) return [...location.node.children].filter((node) => !hidden.has(node.nodeId));
  if (location.root) return [...location.root.children].filter((node) => !hidden.has(node.nodeId));
  // 顶层同样跳过被隐藏的整根，隐藏根的后代不得在这里重新出现。
  return roots
    .filter((root) => !hidden.has(root.nodeId))
    .flatMap((root) => root.children)
    .filter((node) => !hidden.has(node.nodeId));
}

/**
 * 当前层「无可显示条目」的原因。
 *
 * 以隐藏过滤**之前**的直接子项为准：只有原本就没有任何内容才是真空；原本有内容
 * （或被隐藏的整根覆盖）时属于隐藏导致，必须给恢复显示的路径，不能谎称浏览器里为空。
 * 顶层还要识别「整根被隐藏且其下有内容」，否则隐藏全部根会被误写成真空文件夹。
 */
export function emptyLayerKind(
  location: Location,
  roots: readonly BookmarkRootView[],
  hidden: ReadonlySet<string>,
): 'empty' | 'hidden' {
  if (location.node) {
    return location.node.children.some((node) => hidden.has(node.nodeId)) ? 'hidden' : 'empty';
  }
  if (location.root) {
    return location.root.children.some((node) => hidden.has(node.nodeId)) ? 'hidden' : 'empty';
  }
  // 顶层只展示各根的直接子项：隐藏的根只有在原本还含有直接子项时才真的隐藏了内容，
  // 隐藏一个本来就空的根不应把「真空」改写成「被隐藏」。
  const hiddenRootWithChildren = roots.some((root) => hidden.has(root.nodeId) && root.children.length > 0);
  const hiddenChild = roots.some((root) => !hidden.has(root.nodeId)
    && root.children.some((node) => hidden.has(node.nodeId)));
  return hiddenRootWithChildren || hiddenChild ? 'hidden' : 'empty';
}

function ParentCrumb({ label, onClick }: { readonly label: string; readonly onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="min-h-8 rounded-lg px-2 text-xs hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-1">
      {label}
    </button>
  );
}

/**
 * 浏览器收藏夹层级弹层（文件夹模式，以及区域模式的展开入口）。
 *
 * - 从全部浏览器根的直接子项开始，不先出现内部的虚拟根。
 * - 逐层进入，面包屑可回到任意祖先；返回按钮与 Esc 回到上一级，顶层 Esc 关闭。
 * - 空文件夹显示「此文件夹为空」，不静默跳过；分隔符保留位置但不可聚焦。
 * - 当前层只是被隐藏规则覆盖时说明恢复路径，不误写成浏览器里为空。
 * - 只读：没有新建、编辑、移动、删除；管理器引导只给浏览器自带入口的手动步骤。
 */
export function BookmarkFolderDialog({ bookmarks, open, initialFolderId, onOpenChange }: {
  readonly bookmarks: BookmarkContextValue;
  readonly open: boolean;
  readonly initialFolderId: string | null;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { snapshot } = bookmarks;
  const [currentId, setCurrentId] = useState<string | null>(initialFolderId);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  /**
   * 是否发生了层级导航。打开弹层时不置位，让弹层自身的初始聚焦行为保持不变；
   * 关闭时清空，重新打开也不会抢焦点。
   */
  const pendingTitleFocusRef = useRef(false);
  const hidden = useMemo(() => new Set(snapshot.hiddenNodeIds), [snapshot.hiddenNodeIds]);

  useEffect(() => {
    if (open) setCurrentId(initialFolderId);
  }, [open, initialFolderId]);

  /**
   * 层级导航后把焦点交给**仍然挂载**的标题。
   *
   * 返回按钮在根层回到「全部收藏夹」时会被卸载，返回前聚焦它会让焦点掉到 body；
   * 标题是弹层里唯一跨层稳定存在的可聚焦节点（`tabIndex={-1}`），因此导航提交后
   * 由 effect 聚焦标题，随后 Tab 从标题继续进入当前层控件。不依赖 setTimeout。
   */
  useEffect(() => {
    if (!open) {
      pendingTitleFocusRef.current = false;
      return;
    }
    if (!pendingTitleFocusRef.current) return;
    pendingTitleFocusRef.current = false;
    titleRef.current?.focus();
  }, [open, currentId]);

  if (!open) return null;

  const location = locate(snapshot.roots, currentId, hidden);
  const entries = entriesFor(location, snapshot.roots, hidden);
  const emptyKind = emptyLayerKind(location, snapshot.roots, hidden);
  // 目标失效时已在「全部收藏夹」层，没有上一级可回；其余非顶层都算有上一级。
  const canGoBack = currentId !== null && !location.missing;
  const title = location.node
    ? bookmarkDisplayName(location.node)
    : location.root ? location.root.title.trim() || '未命名收藏夹根' : ALL_LABEL;
  const pathText = location.node
    ? bookmarkPathText(location.node.path)
    : location.root ? bookmarkPathText(location.root.path) : '全部浏览器根';
  const stale = snapshot.status === 'stale';

  const navigate = (nodeId: string | null) => {
    if (nodeId === currentId) return;
    pendingTitleFocusRef.current = true;
    setCurrentId(nodeId);
  };
  const goTo = navigate;

  /**
   * 返回上一级。
   *
   * 位于深层时回到真实父层；位于根层时回到「全部收藏夹」；当前目标已失效
   * （`missing`）时 `currentId` 保持不动会反复回退到同一层，因此直接回到全部根。
   */
  const goBack = () => {
    if (location.missing) {
      navigate(null);
      return;
    }
    if (!canGoBack) return;
    const parent = location.trail.length >= 2 ? location.trail[location.trail.length - 2] : null;
    navigate(parent?.nodeId ?? null);
  };

  const activate = (node: BookmarkNodeView) => {
    if (node.kind === 'separator') return;
    if (node.kind === 'folder') { navigate(node.nodeId); return; }
    bookmarks.openBookmark(node);
  };

  return (
    <Dialog open={open} onOpenChange={(next, details) => {
      // 有父级时 Esc 只回退一层，不关闭整个弹层；到顶层再交给对话框关闭。
      if (!next && details.reason === 'escape-key' && canGoBack) {
        details.cancel();
        goBack();
        return;
      }
      onOpenChange(next);
    }}>
      <FloatingDialogContent
        showCloseButton={false}
        aria-describedby={undefined}
        className="w-[min(48rem,calc(100vw-2rem))] gap-4 rounded-4xl bg-popover/95 p-5 backdrop-blur-xl sm:max-w-none"
      >
        <header className="flex items-start justify-between gap-4 pr-10">
          <div className="min-w-0">
            <p className="m-0 mb-1 text-xs text-muted-foreground">浏览器收藏夹 · 只读</p>
            {/* 唯一跨层稳定存在的可聚焦节点：返回/进入后由 effect 聚焦到这里。 */}
            <DialogTitle ref={titleRef} tabIndex={-1} className="truncate text-xl leading-7 font-medium">{title}</DialogTitle>
            <DialogDescription className="mt-1 truncate text-xs text-muted-foreground" title={pathText}>
              当前路径：{pathText}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {canGoBack && (
              <Button type="button" variant="outline" size="sm" onClick={goBack}>
                <ArrowLeftIcon aria-hidden="true" />
                返回
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)} aria-label="关闭收藏夹文件夹">
              关闭
            </Button>
          </div>
        </header>

        <nav aria-label="收藏夹路径" className="flex min-w-0 flex-wrap items-center gap-0.5 rounded-xl bg-muted/60 p-1">
          {location.trail.map((entry, index) => {
            const current = index === location.trail.length - 1;
            return (
              <span key={`${entry.nodeId ?? 'all'}:${index}`} className="flex min-w-0 items-center gap-0.5">
                {index > 0 && <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />}
                {current
                  ? <span aria-current="page" className="truncate px-2 text-xs font-medium">{entry.label.trim() || '未命名文件夹'}</span>
                  : <ParentCrumb label={entry.label.trim() || '未命名文件夹'} onClick={() => goTo(entry.nodeId)} />}
              </span>
            );
          })}
        </nav>

        {snapshot.actionError && <p role="alert" className="m-0 text-xs text-destructive">{snapshot.actionError}</p>}

        {entries.length === 0
          ? (
            <p className="m-0 flex min-h-40 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border/60 p-6 text-center text-sm text-muted-foreground">
              <FolderIcon aria-hidden="true" className="mb-1 size-5" />
              {/*
                过滤前该层还有直接子项（含被隐藏的整根）时，空是隐藏造成的；
                只有原本就没有任何内容才是真空。两种状态必须是不同文案，不能把隐藏误写成
                「浏览器里还没有内容」。
              */}
              {emptyKind === 'hidden' ? (
                <>
                  当前层条目均被隐藏
                  <span className="text-xs">可在设置「浏览器收藏夹 → 完整收藏夹树与隐藏规则」中恢复显示。</span>
                </>
              ) : (
                <>
                  此文件夹为空
                  <span className="text-xs">当前文件夹在浏览器中没有内容；这里不提供新建入口。</span>
                </>
              )}
            </p>
          )
          : (
            <div aria-label="当前文件夹内容" className="flex max-h-[60dvh] min-h-40 flex-col gap-0.5 overflow-y-auto pr-1">
              {entries.map((node) => node.kind === 'separator'
                ? <BookmarkSeparatorRow key={`sep:${node.nodeId}:${node.path.join('/')}`} />
                : (
                  <div key={bookmarkNodeKey(node)} className="flex min-w-0 flex-col">
                    <BookmarkRow node={node} stale={stale} onActivate={activate} />
                  </div>
                ))}
            </div>
          )}

        <footer className="flex flex-col gap-3 border-t border-border/60 pt-3">
          <p className="m-0 text-xs text-muted-foreground">
            {canGoBack ? 'Esc 返回上一级' : 'Esc 关闭'} · Enter 打开 · 关闭后焦点返回原位置
          </p>
          {stale && (
            <p role="status" className="m-0 text-xs text-amber-800 dark:text-amber-300">
              上次读取：{bookmarkReadAtLabel(snapshot.readAt)}，以下内容可能已过期。
            </p>
          )}
          <BookmarkManagerGuidance compact />
        </footer>
      </FloatingDialogContent>
    </Dialog>
  );
}
