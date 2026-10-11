import { PlusIcon } from 'lucide-react';

/** 编辑模式下的新增入口，与网站格子同尺寸以保持网格对齐。 */
export function AddShortcutTile({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="home-readable-focus group flex w-full flex-col items-center gap-2 rounded-2xl p-2 text-center transition-colors outline-none hover:bg-glass/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 md:p-3"
    >
      <span
        aria-hidden="true"
        className="home-readable-surface flex size-12 items-center justify-center rounded-2xl border border-dashed border-glass-border text-glass-foreground-muted group-hover:text-glass-foreground"
      >
        <PlusIcon className="size-5" />
      </span>
      <span className="home-readable-chip home-readable-muted max-w-full truncate text-xs text-glass-foreground-muted group-hover:text-glass-foreground">
        添加网站
      </span>
    </button>
  );
}
