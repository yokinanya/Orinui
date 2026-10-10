import { describe, expect, it } from 'vitest';

import { colorTokensFromSeed, DYNAMIC_COLOR_TOKENS } from '@/features/appearance/color-tokens';
import { contrastHint, wallpaperPolarity } from '@/features/appearance/background-style';

const HEX = /^#[0-9a-f]{6}$/;
const RGBA = /^rgba\(\d+, \d+, \d+, [0-9.]+\)$/;

describe('colorTokensFromSeed', () => {
  it('生成合法的令牌', () => {
    const tokens = colorTokensFromSeed('#3f7d5a', { theme: 'light', overWallpaper: 'light' });

    expect(tokens['--primary']).toMatch(HEX);
    expect(tokens['--primary-foreground']).toMatch(HEX);
    expect(tokens['--glass']).toMatch(RGBA);
    expect(tokens['--glass-foreground']).toMatch(HEX);
    expect(Object.keys(tokens).sort()).toEqual([...DYNAMIC_COLOR_TOKENS].sort());
  });

  it('壁纸明暗决定覆盖文字与半透明表面', () => {
    const onLight = colorTokensFromSeed('#3f7d5a', { theme: 'light', overWallpaper: 'light' });
    const onDark = colorTokensFromSeed('#3f7d5a', { theme: 'light', overWallpaper: 'dark' });

    expect(onLight['--glass-foreground']).not.toBe(onDark['--glass-foreground']);
    expect(onLight['--glass']).not.toBe(onDark['--glass']);
    // 强调色由主题决定，不受壁纸明暗影响
    expect(onLight['--primary']).toBe(onDark['--primary']);

    // 主题决定强调色
    const darkTheme = colorTokensFromSeed('#3f7d5a', { theme: 'dark', overWallpaper: 'dark' });
    expect(darkTheme['--primary']).not.toBe(onLight['--primary']);
  });

  it('相同种子得到相同结果', () => {
    expect(colorTokensFromSeed('#336699', { theme: 'light', overWallpaper: 'light' })).toEqual(colorTokensFromSeed('#336699', { theme: 'light', overWallpaper: 'light' }));
  });

  it('不同种子得到不同的强调色', () => {
    const first = colorTokensFromSeed('#336699', { theme: 'light', overWallpaper: 'light' })['--primary'];
    const second = colorTokensFromSeed('#996633', { theme: 'light', overWallpaper: 'light' })['--primary'];
    expect(first).not.toBe(second);
  });

  it('拒绝非法种子色', () => {
    expect(() => colorTokensFromSeed('red', { theme: 'light', overWallpaper: 'light' })).toThrowError(/需要 #RRGGBB/);
  });

  it('不覆盖大面积表面与错误色', () => {
    const tokens = colorTokensFromSeed('#3f7d5a', { theme: 'light', overWallpaper: 'light' });
    expect(tokens['--background']).toBeUndefined();
    expect(tokens['--destructive']).toBeUndefined();
  });
});

describe('wallpaperPolarity', () => {
  it('亮背景使用深色文字', () => {
    expect(wallpaperPolarity({ kind: 'solid', color: '#ffffff' })).toBe('light');
  });

  it('暗背景使用浅色文字', () => {
    expect(wallpaperPolarity({ kind: 'solid', color: '#101010' })).toBe('dark');
  });

  it('照片与默认背景无法判断', () => {
    expect(wallpaperPolarity({ kind: 'photo', assetId: 'a', maskStrength: 0.3 })).toBeNull();
    expect(wallpaperPolarity({ kind: 'default' })).toBeNull();
  });
});

describe('contrastHint', () => {
  it('浅色主题遇到深色背景时给出提示', () => {
    expect(contrastHint({ kind: 'solid', color: '#101010' }, false)).toMatch(/偏深/);
    expect(contrastHint({ kind: 'solid', color: '#f6f2ea' }, false)).toBeNull();
  });

  it('深色主题遇到浅色背景时给出提示', () => {
    expect(contrastHint({ kind: 'solid', color: '#f6f2ea' }, true)).toMatch(/偏亮/);
    expect(contrastHint({ kind: 'solid', color: '#101010' }, true)).toBeNull();
  });

  it('渐变按两端平均值判断', () => {
    expect(contrastHint({ kind: 'gradient', from: '#000000', to: '#000000', angle: 0 }, false)).toMatch(/偏深/);
  });

  it('照片与默认背景不提示', () => {
    expect(contrastHint({ kind: 'photo', assetId: 'a1', maskStrength: 0.3 }, true)).toBeNull();
    expect(contrastHint({ kind: 'default' }, true)).toBeNull();
  });
});
