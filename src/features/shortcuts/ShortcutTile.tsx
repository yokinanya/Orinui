import { shortcutDisplayName, type Shortcut } from '@/domain/shortcut';
import type { OpenTarget } from '@/domain/settings';
import { cn } from '@/lib/utils';
import { ShortcutIcon } from '@/features/shortcuts/ShortcutIcon';
import { iconFrameStyle } from '@/features/shortcuts/icon-size-style';

interface ShortcutTileProps {
  shortcut: Shortcut;
  /** 编辑模式下不再导航，格子改为可拖动条目 */
  editing?: boolean;
  showName?: boolean;
  openTarget?: OpenTarget;
}

/**
 * 单个网站快捷方式。
 *
 * 视觉规格：图标在上、名称在下，无卡片底；点击在当前标签页打开。
 * 非编辑模式使用链接元素而不是脚本导航，键盘与辅助技术可直接识别。
 *
 * 图片图标仅加载本地 Blob，不请求远程网站。
 */
export function ShortcutTile({ shortcut, editing = false, showName = true, openTarget = 'current-tab' }: ShortcutTileProps) {
  const className = cn(
    'home-readable-focus group flex w-full flex-col items-center gap-2 rounded-2xl p-2 text-center transition-colors outline-none md:p-3',
    editing
      ? 'bg-glass/30 ring-1 ring-glass-border'
      : 'hover:bg-glass/60',
  );

  const name = shortcutDisplayName(shortcut);
  const content = (
    <>
      <span
        aria-hidden="true"
        style={iconFrameStyle()}
        className="home-readable-surface flex shrink-0 items-center justify-center rounded-2xl border border-glass-border/60 bg-glass font-medium text-glass-foreground shadow-sm shadow-black/[0.04]"
      >
        <ShortcutIcon shortcut={shortcut} />
      </span>
      {/* 名称容器必须是零宽基准，长名称才会在格子宽度内省略，而不会把网格列撑宽。 */}
      {showName
        ? <span className="home-readable-chip home-readable-muted block w-full min-w-0 truncate text-xs text-glass-foreground-muted group-hover:text-glass-foreground">
            {name}
          </span>
        : <span className="sr-only">{name}</span>}
    </>
  );

  if (editing) {
    return <div className={className}>{content}</div>;
  }

  return (
    <a href={shortcut.url} className={className} title={name}
      target={openTarget === 'new-tab' ? '_blank' : undefined}
      rel={openTarget === 'new-tab' ? 'noopener noreferrer' : undefined}>
      {content}
    </a>
  );
}
