import { useState } from 'react';
import { HOME_ROW_HEIGHT, WIDGET_HEIGHTS } from '@/domain/home';

export interface WidgetResize {
  readonly dragging: boolean;
  readonly begin: (event: React.PointerEvent<HTMLElement>) => void;
  readonly move: (event: React.PointerEvent<HTMLElement>) => void;
  readonly end: (event: React.PointerEvent<HTMLElement>) => void;
}

/** 拖动位移换算成 2/3/4 行中最接近的一档。 */
export function resolveHeight(from: number, deltaY: number): number {
  const min = WIDGET_HEIGHTS[0] ?? 2;
  const max = WIDGET_HEIGHTS[WIDGET_HEIGHTS.length - 1] ?? min;
  const rows = Math.round((from * HOME_ROW_HEIGHT + deltaY) / HOME_ROW_HEIGHT);
  const clamped = Math.min(Math.max(rows, min), max);
  return WIDGET_HEIGHTS.reduce((best, item) => (Math.abs(item - clamped) < Math.abs(best - clamped) ? item : best), min);
}

/** 右下角拖动调高：按下即开始，移动实时预览，松手提交；点击不改高度。 */
export function useWidgetResize(options: { readonly height: number; readonly preview: (height: number) => void;
  readonly commit: (height: number) => void }): WidgetResize {
  const [dragging, setDragging] = useState(false);
  const [origin, setOrigin] = useState<{ readonly y: number; readonly from: number } | null>(null);
  const begin = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setOrigin({ y: event.clientY, from: options.height });
    setDragging(true);
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    if (origin) options.preview(resolveHeight(origin.from, event.clientY - origin.y));
  };
  const end = (event: React.PointerEvent<HTMLElement>) => {
    if (!origin) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const next = resolveHeight(origin.from, event.clientY - origin.y);
    setOrigin(null);
    setDragging(false);
    if (next !== options.height) options.commit(next);
  };
  return { dragging, begin, move, end };
}
