import { fail } from '@/domain/errors';
import { asRecord } from '@/domain/validate';

export type ThemeMode = 'system' | 'light' | 'dark';

/** 动态配色的来源：跟随当前背景，或使用用户锁定的种子色。 */
export type DynamicColorMode = 'follow' | 'locked';

export type BackgroundKind = 'default' | 'photo' | 'solid' | 'gradient';

export interface DefaultBackground {
  kind: 'default';
}

export interface PhotoBackground {
  kind: 'photo';
  /** 本地图片资源标识；图片只保存在本机，不上传 */
  assetId: string;
  /** 遮罩强度 0–1，仅照片背景使用 */
  maskStrength: number;
}

export interface SolidBackground {
  kind: 'solid';
  color: string;
}

export interface GradientBackground {
  kind: 'gradient';
  from: string;
  to: string;
  /** 渐变方向，单位度 */
  angle: number;
}

export type Background =
  | DefaultBackground
  | PhotoBackground
  | SolidBackground
  | GradientBackground;

export interface DynamicColorSettings {
  enabled: boolean;
  mode: DynamicColorMode;
  /** 手动锁定的种子色；仅 mode 为 locked 时使用 */
  seed: string | null;
}

export interface AppearanceSettings {
  theme: ThemeMode;
  background: Background;
  dynamicColor: DynamicColorSettings;
}

export const MASK_RANGE = { min: 0, max: 1 } as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/;

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function createDefaultAppearance(): AppearanceSettings {
  return {
    theme: 'system',
    background: { kind: 'default' },
    dynamicColor: { enabled: true, mode: 'follow', seed: null },
  };
}

function normalizeHexColor(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HEX_COLOR.test(value.toLowerCase())) {
    fail(`${label}需要 #RRGGBB 形式的颜色`);
  }
  return value.toLowerCase();
}

function validateBackground(value: unknown): Background {
  const raw = asRecord(value, '背景设置');

  switch (raw.kind) {
    case 'default':
      return { kind: 'default' };

    case 'photo': {
      if (typeof raw.assetId !== 'string' || raw.assetId === '') {
        fail('照片背景缺少图片标识');
      }
      const strength = raw.maskStrength;
      if (
        typeof strength !== 'number' ||
        Number.isNaN(strength) ||
        strength < MASK_RANGE.min ||
        strength > MASK_RANGE.max
      ) {
        fail(`遮罩强度需要在 ${MASK_RANGE.min} 到 ${MASK_RANGE.max} 之间`);
      }
      return { kind: 'photo', assetId: raw.assetId, maskStrength: strength };
    }

    case 'solid':
      return { kind: 'solid', color: normalizeHexColor(raw.color, '背景颜色') };

    case 'gradient': {
      const angle = raw.angle;
      if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < 0 || angle > 360) {
        fail('渐变方向需要在 0 到 360 度之间');
      }
      return {
        kind: 'gradient',
        from: normalizeHexColor(raw.from, '渐变起始颜色'),
        to: normalizeHexColor(raw.to, '渐变结束颜色'),
        angle,
      };
    }

    default:
      fail('背景类型不正确');
  }
}

function validateDynamicColor(value: unknown): DynamicColorSettings {
  const raw = asRecord(value, '动态配色设置');

  if (typeof raw.enabled !== 'boolean') {
    fail('动态配色开关不正确');
  }
  if (raw.mode !== 'follow' && raw.mode !== 'locked') {
    fail('动态配色方式不正确');
  }

  let seed: string | null = null;
  if (raw.seed !== null && raw.seed !== undefined) {
    seed = normalizeHexColor(raw.seed, '种子色');
  }
  if (raw.mode === 'locked' && seed === null) {
    fail('锁定配色需要提供种子色');
  }

  return { enabled: raw.enabled, mode: raw.mode, seed };
}

export function validateAppearance(value: unknown): AppearanceSettings {
  const raw = asRecord(value, '外观设置');

  if (!isThemeMode(raw.theme)) {
    fail('主题设置不正确');
  }

  return {
    theme: raw.theme,
    background: validateBackground(raw.background),
    dynamicColor: validateDynamicColor(raw.dynamicColor),
  };
}

/** 取色失败、背景为默认或图片无法解析时使用的中性暖色种子。 */
export const NEUTRAL_SEED = '#8a7f72';

function mixHex(first: string, second: string): string {
  const channels = (hex: string, index: number) => Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
  const mixed = [0, 1, 2].map((index) => Math.round((channels(first, index) + channels(second, index)) / 2));
  return `#${mixed.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** 纯色与渐变背景可直接推出种子色；照片与默认背景返回 null，由调用方决定。 */
export function backgroundSeed(background: Background): string | null {
  if (background.kind === 'solid') return background.color;
  if (background.kind === 'gradient') return mixHex(background.from, background.to);
  return null;
}

/**
 * 计算当前生效的种子色；没有可取色的来源时返回 null。
 *
 * 手动锁定优先；否则用背景自身的颜色；照片由调用方传入从图片提取的结果。
 * 默认背景没有颜色来源，此时保持中性静态主题——视觉规格要求动态色只作轻强调，
 * 不该在没有背景依据时凭空给整页染色。
 */
export function resolveSeed(
  appearance: AppearanceSettings,
  photoSeed: string | null = null,
): string | null {
  if (appearance.dynamicColor.mode === 'locked' && appearance.dynamicColor.seed !== null) {
    return appearance.dynamicColor.seed;
  }
  return backgroundSeed(appearance.background) ?? photoSeed;
}
