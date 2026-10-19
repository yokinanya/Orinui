import { describe, expect, it } from 'vitest';
import { search } from './search-tools-fixture';

describe('安全本地计算与单位换算', () => {
  it('计算表达式和百分比，不执行输入代码', () => {
    expect(search('=2*(3+4)').actions[0]).toMatchObject({ kind: 'copy', value: '14' });
    expect(search('200*10%').actions[0]).toMatchObject({ kind: 'copy', value: '20' });
    expect(search('=1/0').actions[0]).toMatchObject({ kind: 'error', detail: '不能除以零' });
  });

  it('换算同类单位并对不兼容单位返回明确信息', () => {
    expect(search('10 MiB to MB').actions[0]?.value).toBe('10.48576');
    expect(search('25 C to F').actions[0]?.value).toBe('77');
    expect(search('5 kg to seconds').actions[0]).toMatchObject({ kind: 'error' });
    expect(search('2026-10-16').actions).toEqual([]);
  });
});
