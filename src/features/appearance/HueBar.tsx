import type { KeyboardEvent } from 'react';

import { useDragArea } from '@/features/appearance/use-drag-area';

interface HueBarProps {
  /** 0–360 */
  hue: number;
  onPreview: (hue: number) => void;
  onCommit: () => void;
}

const WIDTH = 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)';

/**
 * 色相条。
 *
 * 自己实现而不是套用通用滑块：色相条的轨道本身就是彩虹（通用滑块的输入色轨道与填充区间
 * 在这里没有意义），而且需要给滑块本身一个可访问名称——通用滑块只允许把名称给到内部滑块，
 * 项目里没有透出该参数。
 */
export function HueBar({ hue, onPreview, onCommit }: HueBarProps) {
  const drag = useDragArea((rect, clientX) => {
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    onPreview(Math.round(ratio * 360));
  }, onCommit);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const large = event.shiftKey || event.key === 'PageUp' || event.key === 'PageDown';
    const step = large ? 10 : 1;

    let next: number | null = null;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = hue - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = hue + step;
        break;
      case 'PageDown':
        next = hue - step;
        break;
      case 'PageUp':
        next = hue + step;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = 360;
        break;
      default:
        return;
    }

    event.preventDefault();
    onPreview(Math.min(Math.max(next, 0), 360));
    onCommit();
  };

  return (
    <div
      ref={drag.ref}
      role="slider"
      tabIndex={0}
      aria-label="色相"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hue)}
      aria-valuetext={`色相 ${Math.round(hue)} 度`}
      {...drag.handlers}
      onKeyDown={handleKeyDown}
      className="relative h-3 w-full touch-none rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      style={{ backgroundImage: WIDTH }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/20"
        style={{ left: `${(hue / 360) * 100}%` }}
      />
    </div>
  );
}
