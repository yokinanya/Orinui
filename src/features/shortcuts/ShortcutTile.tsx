import type { Shortcut } from '@/domain/shortcut';
import { cn } from '@/lib/utils';
import { ShortcutIcon } from '@/features/shortcuts/ShortcutIcon';

interface ShortcutTileProps {
  shortcut: Shortcut;
  /** 编辑模式下不再导航，格子改为可拖动条目 */
  editing?: boolean;
}

/**
 * 单个网站快捷方式。
 *
 * 视觉规格：图标在上、名称在下，无卡片底；点击在当前标签页打开。
 * 非编辑模式使用链接元素而不是脚本导航，键盘与辅助技术可直接识别。
 *
 * 图片图标仅加载本地 Blob，不请求远程网站。
 */
export function ShortcutTile({ shortcut, editing = false }: ShortcutTileProps) {
  const className = cn(
    'home-readable-focus group flex w-full flex-col items-center gap-2 rounded-2xl p-2 text-center transition-colors outline-none md:p-3',
    editing
      ? 'bg-glass/30 ring-1 ring-glass-border'
      : 'hover:bg-glass/60 focus-visible:ring-2 focus-visible:ring-ring/50',
  );

  const content = (
    <>
      <span
        aria-hidden="true"
        className="home-readable-surface flex size-12 items-center justify-center rounded-2xl bg-glass text-lg font-medium text-glass-foreground"
      >
        <ShortcutIcon shortcut={shortcut} />
      </span>
      <span className="home-readable-chip home-readable-muted max-w-full truncate text-xs text-glass-foreground-muted group-hover:text-glass-foreground">
        {shortcut.title}
      </span>
    </>
  );

  if (editing) {
    return <div className={className}>{content}</div>;
  }

  return (
    <a href={shortcut.url} className={className}>
      {content}
    </a>
  );
}
