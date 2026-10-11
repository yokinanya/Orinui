import { resolveSeed, type AppearanceSettings } from '@/domain/appearance';
import { requiresHomeReadabilitySurface, wallpaperStyle } from '@/features/appearance/background-style';
import {
  colorTokensFromSeed,
  DYNAMIC_COLOR_TOKENS,
  HOME_READABILITY_TOKEN_NAMES,
  homeReadabilityTokens,
} from '@/features/appearance/color-tokens';

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
  applyHomeReadability(root, appearance, isDark);

  const seed = appearance.dynamicColor.enabled ? resolveSeed(appearance, photoSeed) : null;

  if (seed === null) {
    for (const token of DYNAMIC_COLOR_TOKENS) {
      root.style.removeProperty(token);
    }
    return;
  }

  // 动态色只跟随主题生成；任意壁纸上的正文由独立的局部可读性表面保护。
  const tokens = colorTokensFromSeed(seed, { theme: isDark ? 'dark' : 'light' });
  for (const [token, value] of Object.entries(tokens)) {
    root.style.setProperty(token, value);
  }
}

function applyHomeReadability(
  root: HTMLElement,
  appearance: AppearanceSettings,
  isDark: boolean,
): void {
  if (!requiresHomeReadabilitySurface(appearance.background)) {
    root.removeAttribute('data-home-readable');
    for (const token of HOME_READABILITY_TOKEN_NAMES) root.style.removeProperty(token);
    return;
  }

  root.setAttribute('data-home-readable', 'true');
  for (const [token, value] of Object.entries(homeReadabilityTokens(isDark))) {
    root.style.setProperty(token, value);
  }
}
