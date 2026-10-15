import { fail } from '@/domain/errors';
import { DEFAULT_LAYOUT } from '@/domain/layout';
import { BUILT_IN_ENGINES } from '@/domain/search-engines';
import { validateSettings, type AppSettings } from '@/domain/settings';

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
  ['photo', ['kind', 'assetId', 'maskStrength']],
  ['solid', ['kind', 'color']],
  ['gradient', ['kind', 'from', 'to', 'angle']],
]);

function validateAppearanceShape(value: unknown): void {
  const appearance = record(value, '外观设置');
  exactKeys(appearance, ['theme', 'background', 'dynamicColor'], '外观设置');
  const background = record(appearance.background, '背景设置');
  exactKeys(background, BACKGROUND_FIELDS.get(background.kind) ?? ['kind'], '背景设置');
  exactKeys(record(appearance.dynamicColor, '动态配色'), ['enabled', 'mode', 'seed'], '动态配色');
}

function validateSearchShape(value: unknown, legacy: boolean): void {
  const search = record(value, '搜索设置');
  const keys = legacy
    ? ['defaultEngineId', 'customEngines']
    : ['defaultEngineId', 'customEngines', 'width', 'autoFocus', 'openTarget'];
  exactKeys(search, keys, '搜索设置');
  if (!Array.isArray(search.customEngines)) fail('自定义搜索引擎格式不正确');
  for (const item of search.customEngines) {
    const engine = record(item, '自定义搜索引擎');
    exactKeys(engine, ['id', 'name', 'template', 'builtIn'], '自定义搜索引擎');
    if (typeof engine.id === 'string' && BUILT_IN_ENGINES.some((builtIn) => builtIn.id === engine.id)) {
      fail('自定义引擎不能使用内置标识');
    }
  }
}

function validateLayoutShape(value: unknown, legacy: boolean): void {
  const layout = record(value, '布局设置');
  const keys = legacy ? ['order', 'hidden'] : ['order', 'hidden', 'pageWidth', 'regionSpacing', 'columns'];
  exactKeys(layout, keys, '布局设置');
}

function validateClockShape(value: unknown, legacy: boolean): void {
  const clock = record(value, '时钟设置');
  const keys = legacy
    ? ['format']
    : ['format', 'size', 'showSeconds', 'showDate', 'showWeekday', 'dateFormat', 'weekdayFormat'];
  exactKeys(clock, keys, '时钟设置');
}

export function validateBackupSettings(value: unknown, legacy: boolean): AppSettings {
  const raw = record(value, '设置');
  const keys = legacy
    ? ['appearance', 'search', 'layout', 'clock']
    : ['appearance', 'search', 'shortcuts', 'layout', 'clock'];
  exactKeys(raw, keys, '设置');
  validateAppearanceShape(raw.appearance);
  validateSearchShape(raw.search, legacy);
  validateLayoutShape(raw.layout, legacy);
  validateClockShape(raw.clock, legacy);
  if (!legacy) return validateSettings(value);
  const search = record(raw.search, '搜索设置');
  const layout = record(raw.layout, '布局设置');
  const clock = record(raw.clock, '时钟设置');
  return validateSettings({
    ...raw,
    search: { ...search, width: 'standard', autoFocus: false, openTarget: 'current-tab' },
    shortcuts: { showNames: true, openTarget: 'current-tab' },
    layout: { ...DEFAULT_LAYOUT, ...layout },
    clock: {
      format: clock.format, size: 'standard', showSeconds: false, showDate: true, showWeekday: true,
      dateFormat: 'month-day', weekdayFormat: 'long',
    },
  });
}
