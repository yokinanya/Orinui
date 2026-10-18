import { argbFromHex, hexFromArgb, Hct, themeFromSourceColor, type Scheme } from '@material/material-color-utilities';

import { fail } from '@/domain/errors';

/** 应用到根元素的 CSS 变量集合。 */
export type ColorTokenMap = Record<string, string>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const READABLE_SURFACE_TONE_THRESHOLD = 50;
const HEX_CHANNEL_WIDTH = 2;
const HEX_PREFIX_LENGTH = 1;
const HEX_RADIX = 16;
const RGB_CHANNELS = [0, 1, 2] as const;
const PHOTO_MASK_COLORS = { light: '#faf8f5', dark: '#0c0a08' } as const;

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
    // 次级文字在渐变中间调上仍需 4.5:1，因此比静态令牌加深一档。
    '--home-readable-muted': '#3d3833',
    '--home-readable-border': 'color-mix(in oklch, var(--home-readable-accent) 35%, transparent)',
    '--home-readable-focus': 'var(--home-readable-accent)',
    '--home-readable-accent': 'var(--primary)',
    '--home-readable-text-shadow': 'none',
    '--home-readable-text-outline': 'transparent',
    '--home-readable-photo-foreground': '#ffffff',
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
    '--home-readable-text-shadow': 'none',
    '--home-readable-text-outline': 'transparent',
    '--home-readable-photo-foreground': '#ffffff',
  },
} as const;

const PHOTO_READABILITY = {
  light: {
    '--home-readable-surface': 'rgba(250, 248, 245, 0.52)',
    '--home-readable-search-surface': 'rgba(250, 248, 245, 0.72)',
    '--home-readable-hover': 'rgba(236, 232, 226, 0.76)',
    '--home-readable-foreground': '#000000',
    '--home-readable-muted': '#000000',
    '--home-readable-border': 'rgba(0, 0, 0, 0.26)',
    '--home-readable-text-shadow': '0 1px 3px rgb(0 0 0 / 84%), 0 0 10px rgb(0 0 0 / 56%)',
    '--home-readable-text-outline': 'rgb(0 0 0 / 92%)',
    '--home-readable-photo-foreground': '#ffffff',
  },
  dark: {
    '--home-readable-surface': 'rgba(14, 16, 20, 0.48)',
    '--home-readable-search-surface': 'rgba(14, 16, 20, 0.58)',
    '--home-readable-hover': 'rgba(14, 16, 20, 0.6)',
    '--home-readable-foreground': '#ffffff',
    '--home-readable-muted': '#ffffff',
    '--home-readable-border': 'rgba(255, 255, 255, 0.26)',
    '--home-readable-text-shadow': '0 1px 3px rgb(0 0 0 / 82%), 0 0 9px rgb(0 0 0 / 50%)',
    '--home-readable-text-outline': 'rgb(0 0 0 / 90%)',
    '--home-readable-photo-foreground': '#ffffff',
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

function blendedPhotoColor(backgroundColor: string | null, maskStrength: number, isDark: boolean): string | null {
  if (backgroundColor === null) return null;
  const maskColor = PHOTO_MASK_COLORS[isDark ? 'dark' : 'light'];
  const channels = RGB_CHANNELS.map((channel) => {
    const offset = HEX_PREFIX_LENGTH + channel * HEX_CHANNEL_WIDTH;
    const source = Number.parseInt(backgroundColor.slice(offset, offset + HEX_CHANNEL_WIDTH), HEX_RADIX);
    const mask = Number.parseInt(maskColor.slice(offset, offset + HEX_CHANNEL_WIDTH), HEX_RADIX);
    return Math.round(source * (1 - maskStrength) + mask * maskStrength);
  });
  return `#${channels.map((channel) => channel.toString(HEX_RADIX).padStart(HEX_CHANNEL_WIDTH, '0')).join('')}`;
}

function photoReadabilityTokens(backgroundIsDark: boolean, themeIsDark: boolean): ColorTokenMap {
  const accent = accentToken(backgroundIsDark, themeIsDark);
  return {
    ...PHOTO_READABILITY[backgroundIsDark ? 'dark' : 'light'],
    '--home-readable-focus': accent,
    '--home-readable-accent': accent,
  };
}

/** Solid and gradient backgrounds choose a readable surface from their actual color. */
export function homeReadabilityTokens({
  isDark,
  isPhoto = false,
  backgroundColor = null,
  photoMaskStrength = 0,
}: {
  readonly isDark: boolean;
  readonly isPhoto?: boolean;
  readonly backgroundColor?: string | null;
  readonly photoMaskStrength?: number;
}): ColorTokenMap {
  if (isPhoto) {
    const displayedColor = blendedPhotoColor(backgroundColor, photoMaskStrength, isDark);
    return photoReadabilityTokens(isDarkBackground(displayedColor, isDark), isDark);
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
