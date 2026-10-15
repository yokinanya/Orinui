import type { ClockFormat, DateFormat, WeekdayFormat } from '@/domain/settings';

export function formatClockTime(now: Date, format: ClockFormat, showSeconds: boolean): string {
  const hourCycle = format === '12h' ? 'h12' : format === '24h' ? 'h23' : undefined;
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit', minute: '2-digit', ...(showSeconds ? { second: '2-digit' } : {}),
    ...(hourCycle ? { hourCycle } : {}),
  }).format(now);
}

export function formatClockDate(now: Date, format: DateFormat): string {
  if (format === 'iso') {
    const year = String(now.getFullYear()).padStart(4, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    ...(format === 'year-month-day' ? { year: 'numeric' as const } : {}), month: 'long', day: 'numeric',
  }).format(now);
}

export function formatWeekday(now: Date, format: WeekdayFormat): string {
  return new Intl.DateTimeFormat(format === 'english-short' ? 'en-US' : undefined, {
    weekday: format === 'long' ? 'long' : 'short',
  }).format(now);
}
