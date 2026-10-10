import { argbFromHex, hexFromArgb, themeFromSourceColor, type Scheme } from '@material/material-color-utilities';

import { fail } from '@/domain/errors';

/** 应用到根元素的 CSS 变量集合。 */
export type ColorTokenMap = Record<string, string>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** 浅色与深色的半透明表面透明度不同，玻璃层需要各自的分量。 */
const GLASS_ALPHA = { light: 0.62, dark: 0.55 } as const;
const GLASS_STRONG_ALPHA = { light: 0.9, dark: 0.92 } as const;
const GLASS_BORDER_ALPHA = { light: 0.5, dark: 0.12 } as const;

function rgba(hex: string, alpha: number): string {
  const value = (index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  return `rgba(${value(0)}, ${value(1)}, ${value(2)}, ${alpha})`;
}

/**
 * 只覆盖强调色与壁纸之上的半透明表面。
 *
 * 视觉规格要求动态色只作轻强调：大面积表面、正文层次与错误色仍由静态令牌提供，
 * 否则整页会被壁纸取样色染色。
 */
/** 主题驱动的令牌：强调色与焦点环，跟随用户选择的深浅模式。 */
function accentTokens(scheme: Scheme): ColorTokenMap {
  return {
    '--primary': hexFromArgb(scheme.primary),
    '--primary-foreground': hexFromArgb(scheme.onPrimary),
    '--secondary': hexFromArgb(scheme.secondaryContainer),
    '--secondary-foreground': hexFromArgb(scheme.onSecondaryContainer),
    '--accent': hexFromArgb(scheme.tertiaryContainer),
    '--accent-foreground': hexFromArgb(scheme.onTertiaryContainer),
    '--ring': hexFromArgb(scheme.primary),
  };
}

/** 壁纸之上的半透明表面与被其覆盖的文字，按背景明暗选择，保证可读性。 */
function wallpaperTokens(scheme: Scheme, isDark: boolean): ColorTokenMap {
  const surface = hexFromArgb(scheme.surface);

  return {
    '--glass': rgba(surface, isDark ? GLASS_ALPHA.dark : GLASS_ALPHA.light),
    '--glass-strong': rgba(surface, isDark ? GLASS_STRONG_ALPHA.dark : GLASS_STRONG_ALPHA.light),
    '--glass-border': rgba(surface, isDark ? GLASS_BORDER_ALPHA.dark : GLASS_BORDER_ALPHA.light),
    '--glass-foreground': hexFromArgb(scheme.onSurface),
    '--glass-foreground-muted': hexFromArgb(scheme.onSurfaceVariant),
  };
}

/**
 * 由种子色生成浅色与深色两套覆盖令牌。
 *
 * 使用 Material 官方配色算法（HCT 色调板 + 方案映射），与本项目既有的
 * OKLCH 令牌共存：只覆盖强调色与半透明表面。
 */
export type SchemePolarity = 'light' | 'dark';

export interface SeedTokenInput {
  /** 用户选择的深浅模式（已合并“跟随系统”），决定强调色 */
  theme: SchemePolarity;
  /** 壁纸之上的文字应该用浅色还是深色，决定半透明表面与其上的文字 */
  overWallpaper: SchemePolarity;
}

export function colorTokensFromSeed(seedHex: string, input: SeedTokenInput): ColorTokenMap {
  if (!HEX_COLOR.test(seedHex)) {
    fail('种子色需要 #RRGGBB 形式');
  }

  const theme = themeFromSourceColor(argbFromHex(seedHex));
  const wallpaperScheme = input.overWallpaper === 'dark' ? theme.schemes.dark : theme.schemes.light;

  return {
    ...accentTokens(input.theme === 'dark' ? theme.schemes.dark : theme.schemes.light),
    ...wallpaperTokens(wallpaperScheme, input.overWallpaper === 'dark'),
  };
}

/** 关闭动态配色时需要移除的覆盖令牌名。 */
export const DYNAMIC_COLOR_TOKENS: readonly string[] = Object.keys(
  colorTokensFromSeed('#8a7f72', { theme: 'light', overWallpaper: 'light' }),
);
