import { fail } from '@/domain/errors';
import { BUILT_IN_ENGINES } from '@/domain/search-engines';
import { validateSettings, type AppSettings } from '@/domain/settings';
import { createDefaultSearchCustomization } from '@/domain/search-customization';

export const PREVIOUS_BACKUP_VERSION = 8 as const;
export const CURRENT_BACKUP_VERSION = 9 as const;
export type SupportedBackupVersion = typeof PREVIOUS_BACKUP_VERSION | typeof CURRENT_BACKUP_VERSION;

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const actual = Object.keys(value);
  if (actual.length !== allowed.length || !allowed.every((key) => Object.hasOwn(value, key))) {
    fail(`${label}字段不正确`);
  }
}

const BACKGROUND_FIELDS = new Map<unknown, readonly string[]>([
  ['photo', ['kind', 'assetId', 'maskStrength']], ['motion', ['kind', 'assetId', 'maskStrength']],
  ['solid', ['kind', 'color']], ['gradient', ['kind', 'from', 'to', 'angle']],
]);

function validateAppearanceShape(value: unknown): void {
  const appearance = record(value, '外观设置');
  exactKeys(appearance, ['theme', 'background', 'dynamicColor'], '外观设置');
  const background = record(appearance.background, '背景设置');
  exactKeys(background, BACKGROUND_FIELDS.get(background.kind) ?? ['kind'], '背景设置');
  exactKeys(record(appearance.dynamicColor, '动态配色'), ['enabled', 'mode', 'seed'], '动态配色');
}

function validateSearchShape(value: unknown): void {
  const search = record(value, '搜索设置');
  exactKeys(search, ['defaultEngineId', 'customEngines', 'width', 'autoFocus', 'openTarget', 'customization'], '搜索设置');
  exactKeys(record(search.customization, '搜索自定义设置'),
    ['corner', 'surfaceOpacity', 'placeholder', 'showSites', 'showFolders', 'enabledTools', 'engineKeywords'], '搜索自定义设置');
  if (!Array.isArray(search.customEngines)) fail('自定义搜索引擎格式不正确');
  for (const item of search.customEngines) {
    const engine = record(item, '自定义搜索引擎');
    exactKeys(engine, ['id', 'name', 'template', 'builtIn'], '自定义搜索引擎');
    if (typeof engine.id === 'string' && BUILT_IN_ENGINES.some((builtIn) => builtIn.id === engine.id)) {
      fail('自定义引擎不能使用内置标识');
    }
  }
}

function validateLegacySearchShape(value: unknown): void {
  const search = record(value, '搜索设置');
  exactKeys(search, ['defaultEngineId', 'customEngines', 'width', 'autoFocus', 'openTarget'], '搜索设置');
  if (!Array.isArray(search.customEngines)) fail('自定义搜索引擎格式不正确');
  for (const item of search.customEngines) {
    const engine = record(item, '自定义搜索引擎');
    exactKeys(engine, ['id', 'name', 'template', 'builtIn'], '自定义搜索引擎');
    if (typeof engine.id === 'string' && BUILT_IN_ENGINES.some((builtIn) => builtIn.id === engine.id)) fail('自定义引擎不能使用内置标识');
  }
}

function validateCurrentLayout(value: unknown): Record<string, unknown> {
  const layout = record(value, '布局设置');
  exactKeys(layout, ['order', 'hidden', 'pageWidth', 'regionSpacing', 'columns', 'style', 'clockPosition'], '布局设置');
  return layout;
}

function validateClockShape(value: unknown): void {
  const clock = record(value, '时钟设置');
  exactKeys(clock, ['format', 'size', 'showSeconds', 'showDate', 'showWeekday', 'dateFormat', 'weekdayFormat'], '时钟设置');
}

export function validateBackupSettings(value: unknown, formatVersion: SupportedBackupVersion = CURRENT_BACKUP_VERSION): AppSettings {
  const raw = record(value, '设置');
  exactKeys(raw, ['appearance', 'search', 'shortcuts', 'layout', 'clock'], '设置');
  validateAppearanceShape(raw.appearance);
  if (formatVersion === CURRENT_BACKUP_VERSION) validateSearchShape(raw.search);
  else validateLegacySearchShape(raw.search);
  const layout = validateCurrentLayout(raw.layout);
  validateClockShape(raw.clock);
  const settings = formatVersion === PREVIOUS_BACKUP_VERSION
    ? { ...raw, search: { ...(raw.search as Record<string, unknown>), ...legacySearchDefaults() }, layout }
    : { ...raw, layout };
  return validateSettings(settings);
}

function legacySearchDefaults(): { readonly customization: AppSettings['search']['customization'] } {
  return { customization: createDefaultSearchCustomization() };
}
