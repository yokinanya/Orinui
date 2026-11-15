import { BookmarkIcon, ChevronDownIcon, ChevronRightIcon, FolderIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  bookmarkAddressState, bookmarkCanOpen, bookmarkDisplayName, bookmarkInitial, bookmarkIsRootDirect,
  bookmarkKindLabel, bookmarkNodeKey, bookmarkPathText, bookmarkRowMeta, type BookmarkNodeView,
} from '@/features/bookmarks/bookmark-view';

/** 48px 外框内的字母占位，不抓取 favicon、不发起网络请求。 */
export function BookmarkLetterIcon({ node }: { readonly node: BookmarkNodeView }) {
  return (
    <span aria-hidden="true" className="home-readable-surface flex size-12 shrink-0 items-center justify-center rounded-2xl border border-glass-border/60 bg-glass font-medium text-glass-foreground shadow-sm shadow-black/[0.04]">
      {node.kind === 'folder'
        ? <FolderIcon className="size-5" />
        : <span className="text-base leading-none">{bookmarkInitial(bookmarkDisplayName(node))}</span>}
    </span>
  );
}

/** 地址缺失或缺少协议时可见标为不可用；不隐藏条目，也不伪造地址。 */
export function BookmarkAddressNote({ node }: { readonly node: BookmarkNodeView }) {
  if (node.kind !== 'bookmark') return null;
  const state = bookmarkAddressState(node.url);
  if (state === 'usable') {
    return (
      <span className="flex items-center gap-1 text-xs text-glass-foreground-muted">
        <BookmarkIcon aria-hidden="true" className="size-3" />
        浏览器书签
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-destructive">
      {state === 'missing' ? '地址缺失 · 无法打开' : '地址不完整 · 无法打开'}
    </span>
  );
}

interface BookmarkRowProps {
  readonly node: BookmarkNodeView;
  readonly stale: boolean;
  readonly expanded?: boolean;
  /** 书签交给上下文打开；文件夹按当前模式就地展开、进入下一层或打开弹层。 */
  readonly onActivate: (node: BookmarkNodeView) => void;
  readonly depth?: number;
}

/**
 * 单条浏览器收藏夹行：48px 字母占位、名称、来源与完整路径。
 *
 * 书签只把原始地址交给上下文委托打开；地址缺失或不完整时保持可见、可读，
 * 但明确标为不可打开。文件夹用 `aria-expanded` 表达就地展开状态。
 * 分隔符不经过这里，由调用方渲染为不可聚焦的 `role="separator"`。
 */
export function BookmarkRow({ node, stale, expanded, onActivate, depth = 0 }: BookmarkRowProps) {
  const name = bookmarkDisplayName(node);
  const pathText = bookmarkPathText(node.path);
  const folder = node.kind === 'folder';
  const unusable = node.kind === 'bookmark' && !bookmarkCanOpen(node);
  const meta = bookmarkRowMeta(node);
  const label = `${name}，${bookmarkKindLabel(node.kind)}，${pathText}${unusable ? '，地址不可用' : ''}`;
  return (
    <button
      type="button"
      data-bookmark-node-id={node.nodeId}
      aria-label={label}
      aria-expanded={folder ? expanded : undefined}
      aria-disabled={unusable || undefined}
      title={`${name} · ${pathText}`}
      onClick={() => { if (!unusable) onActivate(node); }}
      style={depth > 0 ? { marginLeft: `${depth * 0.75}rem` } : undefined}
      className={cn(
        'home-readable-focus group flex min-h-16 w-full min-w-0 items-center gap-3 rounded-xl p-2 text-left transition-colors outline-none hover:bg-glass/50',
        unusable && 'cursor-not-allowed hover:bg-transparent',
      )}
    >
      <BookmarkLetterIcon node={node} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('home-readable-ink block truncate text-sm', unusable && 'text-muted-foreground')}>{name}</span>
        <span className="home-readable-muted mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
          {stale && <span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium text-amber-800 dark:text-amber-300">上次读取</span>}
          {bookmarkIsRootDirect(node) && (
            <span className="shrink-0 rounded bg-glass/70 px-1 text-[10px] font-medium">未分类</span>
          )}
          <span className="truncate" title={pathText}>{meta}</span>
        </span>
        <span className="mt-0.5 block truncate"><BookmarkAddressNote node={node} /></span>
      </span>
      {folder && (
        <span className="home-readable-muted flex shrink-0 items-center gap-1 text-xs">
          <span className="hidden sm:inline">{expanded ? '收起' : '展开'}</span>
          {expanded ? <ChevronDownIcon aria-hidden="true" className="size-4" /> : <ChevronRightIcon aria-hidden="true" className="size-4" />}
        </span>
      )}
    </button>
  );
}

/** 分隔符严格保留位置，但不进入 Tab 序列，也不响应点击。 */
export function BookmarkSeparatorRow() {
  return (
    <div role="separator" aria-label="浏览器分隔线，不可操作" className="flex h-8 items-center gap-2 px-2 text-[11px] text-glass-foreground-muted">
      <span aria-hidden="true" className="h-px flex-1 bg-glass-border" />
      <span>浏览器分隔线 · 不可操作</span>
      <span aria-hidden="true" className="h-px flex-1 bg-glass-border" />
    </div>
  );
}

export { bookmarkNodeKey };
