import { useEffect, useState } from 'react';

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

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

/**
 * 时钟与日期。
 *
 * 数据契约 §10：默认跟随系统区域设置。手动固定 12/24 小时制属于外观设置，后续接入。
 */
export function Clock() {
  const now = useMinuteTick();

  return (
    <div className="flex flex-col items-center gap-1">
      <time
        dateTime={now.toISOString()}
        className="text-6xl font-light tracking-tight text-glass-foreground tabular-nums md:text-7xl"
      >
        {timeFormat.format(now)}
      </time>
      <p className="text-sm text-glass-foreground-muted md:text-base">{dateFormat.format(now)}</p>
    </div>
  );
}
