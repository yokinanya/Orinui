import { describe, expect, it } from 'vitest';
import { SEARCH_TOOLS } from '@/domain/search-tools';
import type { SearchToolGroup } from '@/domain/search-tools';
import { search } from './search-tools-fixture';

describe('搜索工具注册表与发现', () => {
  it('注册稳定工具元信息和解析入口', () => {
    expect(SEARCH_TOOLS.map(({ id }) => id)).toEqual(['calculation', 'datetime', 'color', 'github']);
    expect(SEARCH_TOOLS.every(({ aliases, examples, parse }) => aliases.length > 0 && examples.length > 0 && typeof parse === 'function')).toBe(true);
  });

  it('问号列出启用工具示例；功能词发现只回填且不抢搜索', () => {
    const help = search('?', ['color']);
    expect(help).toMatchObject({ explicit: true, preferredId: 'color:discover-1' });
    expect(help.actions.every(({ group, kind }) => group === 'color' && kind === 'fill')).toBe(true);
    for (const keyword of ['计算', '单位', '日期', '时间', '时间戳', '颜色', '对比度', '日期差']) {
      const result = search(keyword);
      expect(result.explicit).toBe(false);
      expect(result.preferredId).toBeUndefined();
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions.every(({ kind }) => kind === 'fill')).toBe(true);
    }
  });

  it('每组返回动作的稳定 ID 唯一', () => {
    for (const query of ['?', 'gh owner/repo', 'gh clone owner/repo', '#abcd', '对比度 #333 #fff', 'ts now', '日期 2026-10-19 + 1天']) {
      const ids = search(query).actions.map(({ id }) => id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('别名查找忽略英文大小写，工具名与示例分开显示且 ID 不随启用组变化', () => {
    expect(search('TS')).toMatchObject({ explicit: true, preferredId: 'datetime:discover-1' });
    const all = search('?').actions.filter(({ group }) => group === 'color').map(({ id }) => id);
    const onlyColor = search('?', ['color']).actions.map(({ id }) => id);
    expect(onlyColor).toEqual(all);
    expect(search('颜色').actions[0]).toMatchObject({ label: '颜色与对比度', detail: '示例：#ff7043' });
  });
});
