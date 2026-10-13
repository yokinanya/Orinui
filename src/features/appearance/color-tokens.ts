import { argbFromHex, hexFromArgb, Hct, themeFromSourceColor, type Scheme } from '@material/material-color-utilities';

import { fail } from '@/domain/errors';

/** 应用到根元素的 CSS 变量集合。 */
export type ColorTokenMap = Record<string, string>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const READABLE_SURFACE_TONE_THRESHOLD = 50;

/** 浅色与深色的半透明表面透明度不同，玻璃层需要各自的分量。 */
const GLASS_ALPHA = { light: 0.62, dark: 0.55 } as const;
const GLASS_STRONG_ALPHA = { light: 0.9, dark: 0.92 } as const;
const GLASS_BORDER_ALPHA = { light: 0.5, dark: 0.12 } as const;

const HOME_READABILITY = {
  light: {
    '--home-readable-surface': 'color-mix(in oklch, rgba(250, 248, 245, 0.68) 94%, var(--home-readable-accent))',
    '--home-readable-search-surface': 'color-mix(in oklch, rgba(250, 248, 245, 0.84) 94%, var(--home-readable-accent))',
    '--home-readable-hover': 'color-mix(in oklch, rgba(236, 232, 226, 0.86) 90%, var(--home-readable-accent))',
    '--home-readable-foreground': '#302c27',
    '--home-readable-muted': '#514b45',
    '--home-readable-border': 'color-mix(in oklch, var(--home-readable-accent) 35%, transparent)',
    '--home-readable-focus': 'var(--home-readable-accent)',
    '--home-readable-accent': 'var(--primary)',
  },
  dark: {
    '--home-readable-surface': 'color-mix(in oklch, rgba(12, 10, 8, 0.68) 94%, var(--home-readable-accent))',
    '--home-readable-search-surface': 'color-mix(in oklch, rgba(12, 10, 8, 0.84) 94%, var(--home-readable-accent))',
    '--home-readable-hover': 'color-mix(in oklch, rgba(38, 35, 31, 0.86) 90%, var(--home-readable-accent))',
    '--home-readable-foreground': '#f4f1ec',
    '--home-readable-muted': '#c4c0b9',
    '--home-readable-border': 'color-mix(in oklch, var(--home-readable-accent) 35%, transparent)',
    '--home-readable-focus': 'var(--home-readable-accent)',
    '--home-readable-accent': 'var(--primary)',
  },
} as const;

export const HOME_READABILITY_TOKEN_NAMES: readonly string[] = Object.keys(HOME_READABILITY.light);

function isDarkBackground(backgroundColor: string | null, themeIsDark: boolean): boolean {
  if (backgroundColor === null) return themeIsDark;
  return Hct.fromInt(argbFromHex(backgroundColor)).tone < READABLE_SURFACE_TONE_THRESHOLD;
}

function accentToken(backgroundIsDark: boolean, themeIsDark: boolean): string {
  return backgroundIsDark === themeIsDark ? 'var(--primary)' : 'var(--primary-foreground)';
}

/** Solid and gradient backgrounds choose a readable surface from their actual color. */
export function homeReadabilityTokens(isDark: boolean, isPhoto = false, backgroundColor: string | null = null): ColorTokenMap {
  if (isPhoto) {
    return {
      '--home-readable-surface': 'rgba(14, 16, 20, 0.48)',
      '--home-readable-search-surface': 'rgba(14, 16, 20, 0.58)',
      '--home-readable-hover': 'rgba(14, 16, 20, 0.6)',
      '--home-readable-foreground': '#ffffff',
      '--home-readable-muted': '#ffffff',
      '--home-readable-border': 'rgba(255, 255, 255, 0.24)',
      '--home-readable-focus': '#ffffff',
      '--home-readable-accent': 'var(--primary)',
    };
  }

  const surfaceIsDark = isDarkBackground(backgroundColor, isDark);
  return {
    ...(surfaceIsDark ? HOME_READABILITY.dark : HOME_READABILITY.light),
    '--home-readable-accent': accentToken(surfaceIsDark, isDark),
  };
}

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

/** 半透明表面跟随主题；任意背景上的正文由独立的局部可读性层保护。 */
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
  /** 用户选择的深浅模式（已合并“跟随系统”），决定强调色与半透明表面 */
  theme: SchemePolarity;
}

export function colorTokensFromSeed(seedHex: string, input: SeedTokenInput): ColorTokenMap {
  if (!HEX_COLOR.test(seedHex)) {
    fail('种子色需要 #RRGGBB 形式');
  }

  const theme = themeFromSourceColor(argbFromHex(seedHex));
  const isDark = input.theme === 'dark';
  const scheme = isDark ? theme.schemes.dark : theme.schemes.light;

  return {
    ...accentTokens(scheme),
    ...wallpaperTokens(scheme, isDark),
  };
}

/** 关闭动态配色时需要移除的覆盖令牌名。 */
export const DYNAMIC_COLOR_TOKENS: readonly string[] = Object.keys(
  colorTokensFromSeed('#8a7f72', { theme: 'light' }),
);
