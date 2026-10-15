import { describe, expect, it } from 'vitest';
import { formatClockDate, formatWeekday } from '@/domain/clock-format';

describe('clock personalization formats', () => {
  it('formats ISO dates with the local calendar day', () => {
    const date = new Date(2026, 9, 15, 0, 15);
    expect(formatClockDate(date, 'iso')).toBe('2026-10-15');
  });

  it('uses English weekday abbreviations independently of the runtime locale', () => {
    const thursday = new Date(2026, 9, 15, 12);
    expect(formatWeekday(thursday, 'english-short')).toBe('Thu');
  });

  it('maps all seven days to the fixed English abbreviations', () => {
    const expected = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const actual = expected.map((_, index) => formatWeekday(new Date(2026, 9, 11 + index, 12), 'english-short'));
    expect(actual).toEqual(expected);
  });

  it('supports complete and abbreviated locale weekdays', () => {
    const thursday = new Date(2026, 9, 15, 12);
    expect(formatWeekday(thursday, 'long')).not.toBe('Thu');
    expect(formatWeekday(thursday, 'short')).not.toBe(formatWeekday(thursday, 'long'));
  });
});
