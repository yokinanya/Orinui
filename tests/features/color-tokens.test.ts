import { describe, expect, it } from 'vitest';

import {
  colorTokensFromSeed,
  DYNAMIC_COLOR_TOKENS,
  homeReadabilityTokens,
} from '@/features/appearance/color-tokens';
import { requiresHomeReadabilitySurface } from '@/features/appearance/background-style';

const HEX = /^#[0-9a-f]{6}$/;
const RGBA = /^rgba\(\d+, \d+, \d+, [0-9.]+\)$/;

describe('colorTokensFromSeed', () => {
  it('生成合法的令牌', () => {
    const tokens = colorTokensFromSeed('#3f7d5a', { theme: 'light' });

    expect(tokens['--primary']).toMatch(HEX);
    expect(tokens['--primary-foreground']).toMatch(HEX);
    expect(tokens['--glass']).toMatch(RGBA);
    expect(tokens['--glass-foreground']).toMatch(HEX);
    expect(Object.keys(tokens).sort()).toEqual([...DYNAMIC_COLOR_TOKENS].sort());
  });

  it('强调色与半透明表面只由种子和主题决定', () => {
    const first = colorTokensFromSeed('#3f7d5a', { theme: 'light' });
    const sameTheme = colorTokensFromSeed('#3f7d5a', { theme: 'light' });
    const darkTheme = colorTokensFromSeed('#3f7d5a', { theme: 'dark' });

    expect(first).toEqual(sameTheme);
    expect(first['--glass-foreground']).not.toBe(darkTheme['--glass-foreground']);
    expect(first['--primary']).not.toBe(darkTheme['--primary']);
  });

  it('相同种子得到相同结果', () => {
    expect(colorTokensFromSeed('#336699', { theme: 'light' })).toEqual(colorTokensFromSeed('#336699', { theme: 'light' }));
  });

  it('不同种子得到不同的强调色', () => {
    const first = colorTokensFromSeed('#336699', { theme: 'light' })['--primary'];
    const second = colorTokensFromSeed('#996633', { theme: 'light' })['--primary'];
    expect(first).not.toBe(second);
  });

  it('拒绝非法种子色', () => {
    expect(() => colorTokensFromSeed('red', { theme: 'light' })).toThrowError(/需要 #RRGGBB/);
  });

  it('不覆盖大面积表面与错误色', () => {
    const tokens = colorTokensFromSeed('#3f7d5a', { theme: 'light' });
    expect(tokens['--background']).toBeUndefined();
    expect(tokens['--destructive']).toBeUndefined();
  });
});

describe('home readability tokens', () => {
  it('纯色背景按亮度选择阅读表面，并在主题反转时选择配对强调色', () => {
    const lightSurface = homeReadabilityTokens(false, false, '#ffffff');
    const darkSurface = homeReadabilityTokens(false, false, '#000000');
    const inverseLightSurface = homeReadabilityTokens(true, false, '#ffffff');

    expect(lightSurface['--home-readable-surface']).toContain('color-mix(in oklch');
    expect(darkSurface['--home-readable-surface']).toContain('color-mix(in oklch');
    expect(lightSurface['--home-readable-surface']).not.toBe(darkSurface['--home-readable-surface']);
    expect(lightSurface['--home-readable-foreground']).toBe(inverseLightSurface['--home-readable-foreground']);
    expect(lightSurface['--home-readable-accent']).toBe('var(--primary)');
    expect(darkSurface['--home-readable-accent']).toBe('var(--primary-foreground)');
    expect(inverseLightSurface['--home-readable-accent']).toBe('var(--primary-foreground)');
  });

  it('跟随主题切换，不读取动态种子色', () => {
    expect(homeReadabilityTokens(false)).toEqual(homeReadabilityTokens(false));
    expect(homeReadabilityTokens(false)['--home-readable-foreground']).not.toBe(
      homeReadabilityTokens(true)['--home-readable-foreground'],
    );
  });

  it('照片背景用白色无底文字与轻透控件表面，不改变默认/纯色主题令牌', () => {
    const photo = homeReadabilityTokens(false, true);
    expect(photo['--home-readable-foreground']).toBe('#ffffff');
    expect(photo['--home-readable-surface']).toBe('rgba(14, 16, 20, 0.48)');
    expect(photo['--home-readable-search-surface']).toBe('rgba(14, 16, 20, 0.58)');
    expect(homeReadabilityTokens(false)).toEqual(homeReadabilityTokens(false, false));
  });
});

describe('requiresHomeReadabilitySurface', () => {
  it('默认背景保留原有透明主页，其它背景增加局部可读性层', () => {
    expect(requiresHomeReadabilitySurface({ kind: 'default' })).toBe(false);
    expect(requiresHomeReadabilitySurface({ kind: 'solid', color: '#000000' })).toBe(true);
    expect(requiresHomeReadabilitySurface({ kind: 'gradient', from: '#000000', to: '#ffffff', angle: 90 })).toBe(true);
    expect(requiresHomeReadabilitySurface({ kind: 'photo', assetId: 'asset', maskStrength: 0 })).toBe(true);
    expect(requiresHomeReadabilitySurface({ kind: 'photo', assetId: 'asset', maskStrength: 1 })).toBe(true);
  });
});
