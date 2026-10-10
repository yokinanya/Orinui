import { resolveSeed, type AppearanceSettings } from '@/domain/appearance';
import { wallpaperPolarity, wallpaperStyle } from '@/features/appearance/background-style';
import { colorTokensFromSeed, DYNAMIC_COLOR_TOKENS } from '@/features/appearance/color-tokens';

export function isDarkActive(theme: AppearanceSettings['theme'], systemPrefersDark: boolean): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return systemPrefersDark;
}

export interface ApplyAppearanceInput {
  appearance: AppearanceSettings;
  systemPrefersDark: boolean;
  /** 照片背景提取出的种子色；未就绪时为 null */
  photoSeed?: string | null;
  /** 照片背景的对象地址 */
  photoUrl?: string | null;
}

/**
 * 把外观设置写到根元素。
 *
 * 主题、背景与动态配色都在这里落地：动态配色只覆盖强调色与半透明表面，
 * 关闭时逐一移除覆盖值，静态令牌随即恢复。
 */
export function applyAppearance({
  appearance,
  systemPrefersDark,
  photoSeed = null,
  photoUrl = null,
}: ApplyAppearanceInput): void {
  const root = document.documentElement;
  const isDark = isDarkActive(appearance.theme, systemPrefersDark);

  root.classList.toggle('dark', isDark);

  const wallpaper = wallpaperStyle({
    background: appearance.background,
    isDark,
    photoUrl,
  });
  root.style.setProperty('--wallpaper', wallpaper.wallpaper);
  root.style.setProperty('--wallpaper-color', wallpaper.wallpaperColor);
  root.style.setProperty('--wallpaper-mask', wallpaper.wallpaperMask);

  const seed = appearance.dynamicColor.enabled ? resolveSeed(appearance, photoSeed) : null;

  if (seed === null) {
    for (const token of DYNAMIC_COLOR_TOKENS) {
      root.style.removeProperty(token);
    }
    return;
  }

  // 壁纸之上的文字按背景亮度决定；无法判断时（照片、默认背景）回退到主题。
  const overWallpaper = wallpaperPolarity(appearance.background) ?? (isDark ? 'dark' : 'light');
  const tokens = colorTokensFromSeed(seed, {
    theme: isDark ? 'dark' : 'light',
    overWallpaper,
  });
  for (const [token, value] of Object.entries(tokens)) {
    root.style.setProperty(token, value);
  }
}
