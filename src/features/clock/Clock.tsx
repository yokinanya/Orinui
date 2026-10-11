import { useEffect, useState } from 'react';
import { useData } from '@/app/data-context';

/**
 * 按分钟边界刷新，而不是每秒重渲染：时钟不显示秒，无需更高频率。
 */
function useMinuteTick(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: number | undefined;

    const scheduleNextMinute = () => {
      const current = new Date();
      const msUntilNextMinute = (60 - current.getSeconds()) * 1000 - current.getMilliseconds();
      timer = window.setTimeout(() => {
        setNow(new Date());
        scheduleNextMinute();
      }, msUntilNextMinute);
    };

    scheduleNextMinute();
    return () => window.clearTimeout(timer);
  }, []);

  return now;
}

function formatTime(now: Date, format: 'system' | '12h' | '24h'): string {
  const hourCycle = format === '12h' ? 'h12' : format === '24h' ? 'h23' : undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', ...(hourCycle ? { hourCycle } : {}),
  }).format(now);
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

/**
 * 时钟与日期。
 *
 * 默认跟随系统区域设置，也可固定 12/24 小时制。
 */
export function Clock() {
  const now = useMinuteTick();
  const { settings } = useData();

  return (
    <div className="flex flex-col items-center gap-1">
      <time
        dateTime={now.toISOString()}
        className="home-readable-chip text-6xl font-light tracking-tight text-glass-foreground tabular-nums md:text-7xl"
      >
        {formatTime(now, settings.clock.format)}
      </time>
      <p className="home-readable-chip home-readable-muted text-sm text-glass-foreground-muted md:text-base">{dateFormat.format(now)}</p>
    </div>
  );
}
