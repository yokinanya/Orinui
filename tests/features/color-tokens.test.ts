import { describe, expect, it } from 'vitest';

import {
  colorTokensFromSeed,
  DYNAMIC_COLOR_TOKENS,
  homeReadabilityTokens,
} from '@/features/appearance/color-tokens';
import { requiresHomeReadabilitySurface } from '@/features/appearance/background-style';

const HEX = /^#[0-9a-f]{6}$/;
const RGBA = /^rgba\(\d+, \d+, \d+, [0-9.]+\)$/;
type RGB = readonly [number, number, number];

function rgbFromHex(hex: string): RGB {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function rgbaParts(value: string): { rgb: RGB; alpha: number } {
  const match = /^rgba\((\d+), (\d+), (\d+), ([0-9.]+)\)$/.exec(value);
  if (!match) throw new Error(`Invalid rgba token: ${value}`);
  return { rgb: [Number(match[1]), Number(match[2]), Number(match[3])], alpha: Number(match[4]) };
}

function composite(foreground: RGB, background: RGB, alpha: number): RGB {
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
  ];
}

function luminance(rgb: RGB): number {
  const linearChannel = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linearChannel(rgb[0]) + 0.7152 * linearChannel(rgb[1]) + 0.0722 * linearChannel(rgb[2]);
}

function contrastRatio(first: RGB, second: RGB): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

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
  it('文字和控件在最坏亮暗壁纸下仍达到 AA 对比', () => {
    const backdrops: readonly RGB[] = [[0, 0, 0], [255, 255, 255]];

    for (const isDark of [false, true]) {
      const tokens = homeReadabilityTokens(isDark);
      const surface = rgbaParts(tokens['--home-readable-surface']!);
      const foreground = rgbFromHex(tokens['--home-readable-foreground']!);
      const muted = rgbFromHex(tokens['--home-readable-muted']!);
      const border = rgbFromHex(tokens['--home-readable-border']!);
      const focus = rgbFromHex(tokens['--home-readable-focus']!);

      for (const backdrop of backdrops) {
        const renderedSurface = composite(surface.rgb, backdrop, surface.alpha);
        expect(contrastRatio(foreground, renderedSurface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(muted, renderedSurface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(border, renderedSurface)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(focus, renderedSurface)).toBeGreaterThanOrEqual(3);
      }
    }
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
