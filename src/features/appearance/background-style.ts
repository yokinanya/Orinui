import type { Background } from '@/domain/appearance';

/** 遮罩颜色按主题保持氛围；局部可读性由独立表面负责。 */
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

    case 'motion':
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

/** User-selected backgrounds need local readable surfaces behind home content. */
export function requiresHomeReadabilitySurface(background: Background): boolean {
  return background.kind !== 'default';
}
