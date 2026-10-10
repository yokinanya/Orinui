import type { Background } from '@/domain/appearance';

/** 遮罩颜色：浅色主题用浅色薄纱，深色主题用深色薄纱，与文字层级保持一致。 */
const MASK_RGB = {
  light: '250, 248, 245',
  dark: '12, 10, 8',
} as const;

export interface WallpaperStyle {
  /** CSS background-image 值 */
  wallpaper: string;
  /** CSS background-color 值 */
  wallpaperColor: string;
  /** 遮罩颜色；未启用遮罩时为 transparent */
  wallpaperMask: string;
  hasMask: boolean;
}

export interface WallpaperInput {
  background: Background;
  isDark: boolean;
  /** 照片背景的对象地址；由调用方在图片就绪后提供，未就绪时为 null */
  photoUrl: string | null;
}

/** 把背景配置翻译成背景层使用的 CSS 变量值。 */
export function wallpaperStyle({ background, isDark, photoUrl }: WallpaperInput): WallpaperStyle {
  const maskRgb = isDark ? MASK_RGB.dark : MASK_RGB.light;

  switch (background.kind) {
    case 'solid':
      return {
        wallpaper: 'none',
        wallpaperColor: background.color,
        wallpaperMask: 'transparent',
        hasMask: false,
      };

    case 'gradient':
      return {
        wallpaper: `linear-gradient(${background.angle}deg, ${background.from}, ${background.to})`,
        wallpaperColor: 'transparent',
        wallpaperMask: 'transparent',
        hasMask: false,
      };

    case 'photo':
      return {
        wallpaper: photoUrl ? `url("${photoUrl}")` : 'none',
        wallpaperColor: 'transparent',
        wallpaperMask: `rgba(${maskRgb}, ${background.maskStrength})`,
        hasMask: true,
      };

    case 'default':
      return {
        wallpaper: 'var(--wallpaper-default)',
        wallpaperColor: 'transparent',
        wallpaperMask: 'transparent',
        hasMask: false,
      };
  }
}

export type WallpaperPolarity = 'light' | 'dark';

/**
 * 壁纸之上的文字应该用浅色还是深色。
 *
 * 照片与默认背景无法事先判断，返回 null，由调用方回退到主题。
 * 视觉规格要求“背景不影响文字可读性”，因此这里按背景亮度决定，而不是只看主题。
 */
export function wallpaperPolarity(background: Background): WallpaperPolarity | null {
  let hex: string;
  if (background.kind === 'solid') {
    hex = background.color;
  } else if (background.kind === 'gradient') {
    hex = averageHex(background.from, background.to);
  } else {
    return null;
  }
  return relativeLuminance(hex) > 0.45 ? 'light' : 'dark';
}

function relativeLuminance(hex: string): number {
  const channel = (index: number) => {
    const value = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

function averageHex(first: string, second: string): string {
  const channel = (hex: string, index: number) =>
    Math.round(
      (Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) +
        Number.parseInt(second.slice(1 + index * 2, 3 + index * 2), 16)) /
        2,
    );
  return `#${[0, 1, 2].map((index) => channel(first, index).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 主题决定文字层级，因此用户选的背景色可能与当前主题冲突。
 *
 * 这里只给出提示，不改写用户选择的颜色：真正的对比度验证要等接入真实
 * 照片与背景后再按实测结果确认。
 */
export function contrastHint(background: Background, isDark: boolean): string | null {
  let hex: string;
  if (background.kind === 'solid') {
    hex = background.color;
  } else if (background.kind === 'gradient') {
    hex = averageHex(background.from, background.to);
  } else {
    return null;
  }

  const luminance = relativeLuminance(hex);
  if (!isDark && luminance < 0.35) {
    return '这个背景偏深，浅色主题下的文字可能不易阅读，建议改用深色主题。';
  }
  if (isDark && luminance > 0.6) {
    return '这个背景偏亮，深色主题下的文字可能不易阅读，建议改用浅色主题。';
  }
  return null;
}
