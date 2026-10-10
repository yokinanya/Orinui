import { useCallback, useEffect, useRef } from 'react';

/**
 * 把高频变化合并成低频提交，并保证最后一次变化一定会提交。
 *
 * 拖动取色时每一次 pointermove 都写一次设置会带来大量无意义的数据库写入与整页重绘；
 * 这里限制提交频率，但保留尾随提交：即使变化恰好落在节流窗口内、之后不再有变化，
 * 也会在窗口结束时提交。`flush` 用于拖动结束这类需要立即落定的时刻。
 */
export function useThrottledEmit(onEmit: (value: string) => void, intervalMs = 80) {
  const lastRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const latestRef = useRef<string | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const flush = useCallback(() => {
    clearTimer();
    const pending = latestRef.current;
    if (pending === null) return;

    latestRef.current = null;
    lastRef.current = performance.now();
    onEmit(pending);
  }, [onEmit]);

  const emit = useCallback(
    (value: string) => {
      latestRef.current = value;
      const wait = intervalMs - (performance.now() - lastRef.current);
      if (wait <= 0) {
        flush();
        return;
      }
      if (timerRef.current === null) {
        timerRef.current = window.setTimeout(flush, wait);
      }
    },
    [flush, intervalMs],
  );

  useEffect(() => clearTimer, []);

  return { emit, flush };
}
