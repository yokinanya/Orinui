import type { KeyboardEvent } from 'react';

import { hueCss, type Hsv } from '@/features/appearance/color-math';
import { useDragArea } from '@/features/appearance/use-drag-area';

interface SaturationValueAreaProps {
  hsv: Hsv;
  onPreview: (hsv: Hsv) => void;
  onCommit: () => void;
}

function percent(value: number): number {
  return Math.min(Math.max(value, 0), 100);
}

/**
 * 饱和度 / 明度二维面板。
 *
 * 底色是纯色相，再叠一层横向白→透明与一层纵向透明→黑，得到标准的 HSV 面板。
 * ARIA 没有二维滑块，因此 `aria-valuenow` 绑定明度、`aria-valuetext` 同时说明两个维度；
 * 方向键左右调饱和度、上下调明度（按住 Shift 每次 10%），键盘也能到达任意颜色。
 */
export function SaturationValueArea({ hsv, onPreview, onCommit }: SaturationValueAreaProps) {
  const drag = useDragArea((rect, clientX, clientY) => {
    onPreview({
      ...hsv,
      s: percent(((clientX - rect.left) / rect.width) * 100),
      v: percent((1 - (clientY - rect.top) / rect.height) * 100),
    });
  }, onCommit);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 1;
    const next = { ...hsv };

    switch (event.key) {
      case 'ArrowLeft':
        next.s = percent(hsv.s - step);
        break;
      case 'ArrowRight':
        next.s = percent(hsv.s + step);
        break;
      case 'ArrowUp':
        next.v = percent(hsv.v + step);
        break;
      case 'ArrowDown':
        next.v = percent(hsv.v - step);
        break;
      default:
        return;
    }

    event.preventDefault();
    onPreview(next);
    onCommit();
  };

  return (
    <div
      ref={drag.ref}
      role="slider"
      tabIndex={0}
      aria-label="饱和度和明度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.v)}
      aria-valuetext={`饱和度 ${Math.round(hsv.s)}%，明度 ${Math.round(hsv.v)}%`}
      {...drag.handlers}
      onKeyDown={handleKeyDown}
      className="relative h-32 w-full touch-none rounded-2xl outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
      style={{
        backgroundColor: hueCss(hsv.h),
        backgroundImage:
          'linear-gradient(to top, #000, rgb(0 0 0 / 0)), linear-gradient(to right, #fff, rgb(255 255 255 / 0))',
      }}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md ring-1 ring-black/20"
        style={{ left: `${hsv.s}%`, top: `${100 - hsv.v}%` }}
      />
    </div>
  );
}
