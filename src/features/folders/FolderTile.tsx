import { FolderIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/**
 * 网格中的文件夹格子。
 *
 * 视觉规格与网站格子一致：图标方框在上、名称在下，点击打开文件夹弹层。
 * 文件夹不可拖动或重排，这里始终是普通按钮；`data-folder-id` 供层级导航返回时恢复焦点。
 */
export function FolderTile({ folderId, name, editing, onClick }: {
  readonly folderId: string;
  readonly name: string;
  readonly editing: boolean;
  readonly onClick: () => void;
}) {
  const className = cn(
    'home-readable-focus group flex h-20 w-full flex-row items-center gap-3 rounded-2xl p-2 text-left transition-colors outline-none',
    editing ? 'bg-glass/30 ring-1 ring-glass-border' : 'hover:bg-glass/60',
  );
  return (
    <button data-folder-tile data-folder-id={folderId} type="button" onClick={onClick} title={name} className={className}>
      <span
        aria-hidden="true"
        className="home-readable-surface flex size-12 shrink-0 items-center justify-center rounded-2xl border border-glass-border/60 bg-glass font-medium text-glass-foreground shadow-sm shadow-black/[0.04]"
      >
        <FolderIcon className="size-5" />
      </span>
      <span className="home-readable-chip home-readable-muted block min-w-0 flex-1 truncate text-base text-glass-foreground-muted group-hover:text-glass-foreground">
        {name}
      </span>
    </button>
  );
}
