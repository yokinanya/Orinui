import { describe, expect, it } from 'vitest';
import { getSearchToolResults } from '@/domain/search-tools';
import type { SearchToolContext, SearchToolGroup } from '@/domain/search-tools';
import { search } from './search-tools-fixture';

const ALL: readonly SearchToolGroup[] = ['calculation', 'datetime', 'color', 'github'];
const CONTEXT: SearchToolContext = { now: new Date('2026-10-19T04:05:06.000Z'), timeZone: 'Asia/Hong_Kong' };

describe('日期与时间', () => {
  it('ts now 与 unix 产生可读、完整的复制值', () => {
    const result = search('ts now');
    expect(result).toMatchObject({ explicit: true, preferredId: 'datetime:local' });
    expect(result.actions.map(({ value, detail }) => value === detail)).toEqual([true, true, true, true]);
    expect(result.actions[2]?.value).toBe('1792382706');
    expect(search('unix:0').actions[1]?.value).toBe('1970-01-01T00:00:00.000Z');
    expect(search('unixms:0').actions[1]?.value).toBe('1970-01-01T00:00:00.000Z');
  });

  it('严格校验 ISO、偏移和闰日，裸日期不自动计算', () => {
    expect(search('2026-10-16T09:00+08:00').actions[0]?.value).toBe('2026-10-16 09:00:00');
    expect(search('ts 2024-02-29T09:00Z').actions[0]?.kind).toBe('copy');
    expect(search('ts 2026-02-29T09:00Z').actions[0]?.kind).toBe('error');
    expect(search('ts 2026-02-30T09:00:00Z').actions[0]?.kind).toBe('error');
    expect(search('2026-10-16').actions).toEqual([]);
    expect(search('1234567890').explicit).toBe(false);
    expect(search('1234567890').preferredId).toBeUndefined();
  });

  it('按目标时区转换并遵守夏令时跳变', () => {
    const converted = search('2026-10-16T09:00:00+08:00 to UTC');
    expect(converted.actions[0]?.value).toBe('2026-10-16 01:00:00 UTC');
    expect(search('2026-03-08T07:30:00Z to America/New_York').actions[0]?.value)
      .toBe('2026-03-08 03:30:00 EDT');
    expect(search('2026-03-08T06:30:00Z to America/New_York').actions[0]?.value)
      .toBe('2026-03-08 01:30:00 EST');
    const badZone = getSearchToolResults({ query: '2026-03-08T07:30:00Z to Mars/Nowhere', context: CONTEXT, enabledGroups: ALL });
    expect(badZone.actions[0]?.kind).toBe('error');
  });

  it('中英文日期加减和日期差校验闰年并附星期', () => {
    expect(search('日期 2026-10-19 + 7天').actions[0]).toMatchObject({ value: '2026-10-26', detail: '2026-10-26 星期一' });
    expect(search('date 2024-02-28 + 1d').actions[0]?.value).toBe('2024-02-29');
    expect(search('date 9999-12-31 + 1d').actions[0]?.value).toBe('+010000-01-01');
    expect(search('datediff 2026-10-01 2026-10-19').actions[0]?.value).toBe('18');
    expect(search('日期差 2026-02-29 2026-03-01').actions[0]?.kind).toBe('error');
    expect(search('日期 2026-02-30 + 1天').actions[0]?.kind).toBe('error');
  });

  it('关闭时显式命令报错，隐式候选不抢搜索', () => {
    expect(search('ts now', []).actions[0]).toMatchObject({ kind: 'error', detail: '日期时间工具已关闭' });
    expect(search('2026-10-16T09:00:00Z', []).actions).toEqual([]);
  });

  it('显式日期格式错误和无效时区都返回错误动作', () => {
    expect(search('日期 nonsense').actions[0]?.kind).toBe('error');
    expect(search('date 2026-1-2 + 7d').actions[0]?.kind).toBe('error');
    expect(search('2026-10-19T00:00Z to Invalid').actions[0]?.kind).toBe('error');
  });
});
