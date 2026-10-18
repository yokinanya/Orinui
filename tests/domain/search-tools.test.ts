import { describe, expect, it } from 'vitest';
import { parseSearchTool } from '@/domain/search-tools';

describe('搜索工具解析', () => {
  it('把 GitHub issue/PR 短写映射到编号地址，不解析普通仓库文字', () => {
    expect(parseSearchTool('owner/repo#123')).toMatchObject({ kind: 'open',
      value: 'https://github.com/owner/repo/issues/123' });
    expect(parseSearchTool('owner/repo')).toBeNull();
  });

  it('安全计算显式算式、百分号和运算优先级', () => {
    expect(parseSearchTool('=2*(3+4)')).toMatchObject({ kind: 'copy', value: '14' });
    expect(parseSearchTool('200*10%')).toMatchObject({ kind: 'copy', value: '20' });
    expect(parseSearchTool('=1/0')).toMatchObject({ kind: 'error', detail: '不能除以零' });
    expect(parseSearchTool('2026-10-16')).toBeNull();
  });

  it('区分十进制与二进制容量并转换温度', () => {
    expect(parseSearchTool('10 MiB to MB')).toMatchObject({ kind: 'copy', value: '10.48576' });
    expect(parseSearchTool('25 C to F')).toMatchObject({ kind: 'copy', value: '77' });
    expect(parseSearchTool('5 kg to seconds')).toMatchObject({ kind: 'error' });
  });

  it('要求显式区分秒/毫秒时间戳并验证目标时区', () => {
    expect(parseSearchTool('unixms:0')).toMatchObject({ kind: 'copy', value: expect.stringContaining('1970-01-01T00:00:00.000Z') });
    expect(parseSearchTool('2026-10-16T09:00:00+08:00 to UTC')).toMatchObject({ kind: 'copy', value: '2026-10-16 01:00:00 UTC' });
  });
});
