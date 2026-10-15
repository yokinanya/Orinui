import { useEffect, useState } from 'react';
import { useData } from '@/app/data-context';
import { formatClockDate, formatClockTime, formatWeekday } from '@/domain/clock-format';
import type { ClockSize } from '@/domain/settings';

const CLOCK_SIZE_CLASSES: Record<ClockSize, string> = {
  small: 'text-5xl md:text-6xl', standard: 'text-6xl md:text-7xl', large: 'text-7xl md:text-8xl',
};

function useClockTime(showSeconds: boolean): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    let timer: number;
    const schedule = () => {
      const current = new Date();
      const untilNextMinute = (60 - current.getSeconds()) * 1000 - current.getMilliseconds();
      const delay = showSeconds ? 1000 - current.getMilliseconds() : untilNextMinute;
      timer = window.setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    return () => window.clearTimeout(timer);
  }, [showSeconds]);
  return now;
}

export function Clock() {
  const { settings } = useData();
  const { clock } = settings;
  const now = useClockTime(clock.showSeconds);
  const dateParts = [
    clock.showDate ? formatClockDate(now, clock.dateFormat) : '',
    clock.showWeekday ? formatWeekday(now, clock.weekdayFormat) : '',
  ].filter(Boolean);
  return (
    <div className="flex flex-col items-center gap-1">
      <time dateTime={now.toISOString()}
        className={`home-readable-ink ${CLOCK_SIZE_CLASSES[clock.size]} font-light tracking-tight text-glass-foreground tabular-nums`}>
        {formatClockTime(now, clock.format, clock.showSeconds)}
      </time>
      {dateParts.length > 0 && <p className="home-readable-chip home-readable-muted text-sm text-glass-foreground-muted md:text-base">
        {dateParts.join(' · ')}
      </p>}
    </div>
  );
}
