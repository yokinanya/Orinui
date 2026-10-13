import { describe, expect, it } from 'vitest';
import { parseSvgStyle } from '@/platform/svg-style';
import { validateSvgAttributeValue } from '@/platform/svg-references';

describe('SVG 根节点布局 style', () => {
  it.each(['flex:none;line-height:1', ' LINE-HEIGHT : 1 ; FLEX : none; ', ''])('接受明确的布局声明 %s', (source) => {
    expect(() => parseSvgStyle(source, true)).not.toThrow();
  });

  it.each(['background:red', 'flex:none;line-height:2',
    '--color:red', 'flex:n\\6fne', '/*comment*/flex:none', 'flex:none;broken', 'flex:none\nfill:red'])('拒绝未支持样式 %s', (source) => {
    expect(() => parseSvgStyle(source, true)).toThrow();
  });

  it('拒绝子节点 style', () => {
    expect(() => parseSvgStyle('flex:none', false)).toThrow('SVG 布局 style 仅支持根节点');
  });

  it('保留重复声明的顺序及 important，支持静态绘制属性', () => {
    expect(parseSvgStyle('fill:red!important;fill:blue;stroke-width:2', false)).toEqual([
      { property: 'fill', value: 'red', important: true, layout: false },
      { property: 'fill', value: 'blue', important: false, layout: false },
      { property: 'stroke-width', value: '2', important: false, layout: false },
    ]);
  });

  it.each(['url(https://example.com/x)', 'url(data:image/png;base64,AA)', 'url(#a) red', 'var(--fill)', 'url(#a) url(#b)'])('拒绝外部或不明确引用 %s', (value) => {
    expect(() => validateSvgAttributeValue('fill', value)).toThrow();
  });

  it.each(['url(#gradient)', 'url("#gradient")', "url('#gradient')"])('支持内部引用 %s', (value) => {
    expect(() => validateSvgAttributeValue('fill', value)).not.toThrow();
  });
});
