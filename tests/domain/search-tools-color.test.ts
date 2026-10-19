import { describe, expect, it } from 'vitest';
import { search } from './search-tools-fixture';

describe('颜色格式与对比度', () => {
  it.each(['rgb(0xff 0 0)', 'rgb(0b1 0 0)', 'rgba(1, 2, 3, 0x1)', 'rgb(1,,2,3)', 'hsl(120 nope% 50%)'])
  ('拒绝非法 CSS 数值 %s', (value) => {
    expect(search(`颜色 ${value}`).actions[0]?.kind).toBe('error');
  });
  it.each(['#abc', '#abcd', '#aabbcc', '#aabbccdd'])('解析 HEX %s 并保留透明度转换', (query) => {
    const result = search(query);
    expect(result).toMatchObject({ explicit: false, preferredId: 'color:rgb' });
    expect(result.actions.map(({ id }) => id)).toEqual(['color:hex', 'color:rgb', 'color:hsl']);
    expect(result.actions[0]?.swatch).toMatch(/^(#|rgb\()/);
  });

  it('往返转换透明 rgba/HEX，并按来源选默认格式', () => {
    const rgba = search('rgba(255, 0, 0, 0.5)');
    expect(rgba.actions[0]?.value).toBe('#ff000080');
    expect(search(rgba.actions[0]!.value).actions[0]?.value).toBe('#ff000080');
    expect(search('#abcd').actions[0]?.value).toBe('#aabbccdd');
    expect(search('rgb(255 0 0)').preferredId).toBe('color:hex');
    expect(search('hsl(120 100% 50%)').actions[0]?.value).toBe('#00ff00');
    expect(search('hsl(120 nope% 50%)').actions).toEqual([]);
    expect(search('rgb(1,,2,3)').actions).toEqual([]);
    expect(search('rgba(1, Infinity, 2, 1)').actions).toEqual([]);
    expect(search('red').actions).toEqual([]);
  });

  it('对透明前景合成计算 WCAG，并拒绝透明背景', () => {
    expect(search('对比度 rgba(0, 0, 0, 0.5) #fff').actions[0]).toMatchObject({
      kind: 'copy', value: '3.98:1', contrast: { foreground: 'rgba(0, 0, 0, 0.5)', background: '#fff' },
    });
    expect(search('contrast #000 on #ffffff80').actions[0]).toMatchObject({ kind: 'error' });
    expect(search('contrast #000 #fff').actions[0]).toMatchObject({ kind: 'error' });
    expect(search('颜色 #123456', []).actions[0]).toMatchObject({ kind: 'error' });
  });
});
