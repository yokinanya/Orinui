import { BUILT_IN_ICON_IDS, type BuiltInIconId, type ShortcutIcon } from '@/domain/shortcut';

export const SHORTCUT_ICON_OCCUPANCY = { minimum: 50, maximum: 100, default: 75, step: 1 } as const;
const LEGACY_ICON_SIZE = { minimum: 24, maximum: 64, default: 48 } as const;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('网站图标格式不正确');
  return value as Record<string, unknown>;
}

function validateOccupancy(value: unknown, provided: boolean): number | undefined {
  if (!provided) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)
    || value < SHORTCUT_ICON_OCCUPANCY.minimum || value > SHORTCUT_ICON_OCCUPANCY.maximum) {
    throw new Error(`图标占比必须是 ${SHORTCUT_ICON_OCCUPANCY.minimum}% 到 ${SHORTCUT_ICON_OCCUPANCY.maximum}% 之间的整数`);
  }
  return value === SHORTCUT_ICON_OCCUPANCY.default ? undefined : value;
}

function migrateLegacySize(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)
    || value < LEGACY_ICON_SIZE.minimum || value > LEGACY_ICON_SIZE.maximum) {
    throw new Error(`旧版图标尺寸必须是 ${LEGACY_ICON_SIZE.minimum} 到 ${LEGACY_ICON_SIZE.maximum} 之间的整数`);
  }
  const occupancy = Math.max(SHORTCUT_ICON_OCCUPANCY.minimum,
    Math.min(SHORTCUT_ICON_OCCUPANCY.maximum,
      Math.round(value / LEGACY_ICON_SIZE.default * SHORTCUT_ICON_OCCUPANCY.maximum)));
  return occupancy === SHORTCUT_ICON_OCCUPANCY.default ? undefined : occupancy;
}

function readOccupancy(raw: Record<string, unknown>): number | undefined {
  const hasLegacySize = Object.hasOwn(raw, 'size');
  const hasOccupancy = Object.hasOwn(raw, 'occupancy');
  if (hasLegacySize && hasOccupancy) throw new Error('网站图标不能同时包含旧尺寸和新占比');
  return hasLegacySize ? migrateLegacySize(raw.size) : validateOccupancy(raw.occupancy, hasOccupancy);
}

export function parseSvgIconColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/.test(value)) {
    throw new Error('SVG 图标颜色必须是小写 #rrggbb 格式');
  }
  return value;
}

function validateKeys(raw: Record<string, unknown>, required: readonly string[], optional: readonly string[] = ['size', 'occupancy']): void {
  const allowed = [...required, ...optional];
  if (Object.keys(raw).some((key) => !allowed.includes(key))
    || required.some((key) => !Object.hasOwn(raw, key))) throw new Error('网站图标字段不正确');
}

function occupiedIcon<T extends ShortcutIcon>(icon: T, occupancy: number | undefined): T {
  return (occupancy === undefined ? icon : { ...icon, occupancy }) as T;
}

export function parseShortcutIcon(value: unknown): ShortcutIcon {
  const raw = record(value);
  const occupancy = readOccupancy(raw);
  if (raw.kind === 'letter') {
    validateKeys(raw, ['kind']);
    return occupiedIcon({ kind: 'letter' }, occupancy);
  }
  if (raw.kind === 'built-in') {
    validateKeys(raw, ['kind', 'iconId']);
    if (typeof raw.iconId !== 'string' || !BUILT_IN_ICON_IDS.includes(raw.iconId as BuiltInIconId)) {
      throw new Error('内置图标标识不正确');
    }
    return occupiedIcon({ kind: 'built-in', iconId: raw.iconId as BuiltInIconId }, occupancy);
  }
  if (raw.kind === 'asset') {
    validateKeys(raw, ['kind', 'assetId'], ['size', 'occupancy', 'color']);
    if (typeof raw.assetId !== 'string' || raw.assetId.trim() !== raw.assetId || raw.assetId.trim() === '') {
      throw new Error('图标资源标识不能为空或含首尾空白');
    }
    const asset = { kind: 'asset' as const, assetId: raw.assetId,
      ...(Object.hasOwn(raw, 'color') ? { color: parseSvgIconColor(raw.color) } : {}) };
    return occupiedIcon(asset, occupancy);
  }
  throw new Error('网站图标类型不正确');
}

export function shortcutIconOccupancy(icon: ShortcutIcon): number {
  return validateOccupancy(icon.occupancy, Object.hasOwn(icon, 'occupancy')) ?? SHORTCUT_ICON_OCCUPANCY.default;
}
