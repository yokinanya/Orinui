import { useRef, type PointerEvent } from 'react';

/**
 * 把一次指针拖动换算成容器内的百分比坐标。
 *
 * 二维面板与色相条共用这段逻辑：按下即取点并捕获指针，移动时持续更新，
 * 抬起时释放捕获并落定。用指针捕获而不是监听 document，拖动到元素外也不会丢事件。
 */
export function useDragArea(
  apply: (rect: DOMRect, clientX: number, clientY: number) => void,
  onRelease: () => void,
) {
  const ref = useRef<HTMLDivElement>(null);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    apply(rect, event.clientX, event.clientY);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !event.currentTarget.hasPointerCapture(event.pointerId)) return;

    apply(rect, event.clientX, event.clientY);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;

    event.currentTarget.releasePointerCapture(event.pointerId);
    onRelease();
  };

  return {
    ref,
    handlers: {
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerUp,
    },
  };
}
