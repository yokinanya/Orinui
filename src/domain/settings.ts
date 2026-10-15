import {
  createDefaultAppearance,
  validateAppearance,
  type AppearanceSettings,
} from '@/domain/appearance';
import { fail } from '@/domain/errors';
import { DEFAULT_LAYOUT, validateLayout, type LayoutConfig } from '@/domain/layout';
import { LIMITS } from '@/domain/limits';
import { resolveEngine, validateEngineTemplate, type SearchEngine } from '@/domain/search-engines';
import { normalizeEngineName } from '@/domain/text';
import { asRecord } from '@/domain/validate';

/** 时钟格式三态：跟随系统或手动固定。 */
export type ClockFormat = 'system' | '12h' | '24h';
export type ClockSize = 'small' | 'standard' | 'large';
export type DateFormat = 'month-day' | 'year-month-day' | 'iso';
export type WeekdayFormat = 'long' | 'short' | 'english-short';
export type OpenTarget = 'current-tab' | 'new-tab';

export interface SearchPreferences {
  width: 'narrow' | 'standard' | 'wide';
  autoFocus: boolean;
  openTarget: OpenTarget;
}

export interface ShortcutPreferences {
  showNames: boolean;
  openTarget: OpenTarget;
}

export interface AppSettings {
  appearance: AppearanceSettings;
  search: {
    defaultEngineId: string;
    /** 用户自定义引擎，上限见 LIMITS.customEngines */
    customEngines: SearchEngine[];
  } & SearchPreferences;
  shortcuts: ShortcutPreferences;
  layout: LayoutConfig;
  clock: {
    format: ClockFormat;
    size: ClockSize;
    showSeconds: boolean;
    showDate: boolean;
    showWeekday: boolean;
    dateFormat: DateFormat;
    weekdayFormat: WeekdayFormat;
  };
}

const CLOCK_FORMATS = ['system', '12h', '24h'] as const;
const CLOCK_SIZES = ['small', 'standard', 'large'] as const;
const DATE_FORMATS = ['month-day', 'year-month-day', 'iso'] as const;
const WEEKDAY_FORMATS = ['long', 'short', 'english-short'] as const;
const OPEN_TARGETS = ['current-tab', 'new-tab'] as const;
const SEARCH_WIDTHS = ['narrow', 'standard', 'wide'] as const;

function chooseSettingValue<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) fail(`${label}设置不正确`);
  return value as T;
}

function booleanSetting(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label}设置不正确`);
  return value;
}

/** 数据契约 §10 的默认值。 */
export function createDefaultSettings(): AppSettings {
  return {
    appearance: createDefaultAppearance(),
    search: { defaultEngineId: 'google', customEngines: [], width: 'standard', autoFocus: false, openTarget: 'current-tab' },
    shortcuts: { showNames: true, openTarget: 'current-tab' },
    layout: { ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order], hidden: [...DEFAULT_LAYOUT.hidden] },
    clock: {
      format: 'system', size: 'standard', showSeconds: false, showDate: true, showWeekday: true,
      dateFormat: 'month-day', weekdayFormat: 'long',
    },
  };
}

export function isClockFormat(value: unknown): value is ClockFormat {
  return CLOCK_FORMATS.includes(value as ClockFormat);
}

function requiredEngineText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label}不正确`);
  return value;
}

function parseCustomEngine(value: unknown): SearchEngine {
  const raw = asRecord(value, '自定义搜索引擎');
  const id = requiredEngineText(raw.id, '自定义搜索引擎标识');
  const template = requiredEngineText(raw.template, '自定义搜索引擎搜索地址');
  const name = requiredEngineText(raw.name, '自定义搜索引擎名称');
  if (raw.builtIn === true) fail('内置搜索引擎不能写入自定义列表');
  return { id, name: normalizeEngineName(name), template: validateEngineTemplate(template), builtIn: false };
}

function validateCustomEngines(value: unknown): SearchEngine[] {
  if (value == null) return [];
  if (!Array.isArray(value)) fail('自定义搜索引擎格式不正确');
  if (value.length > LIMITS.customEngines) fail(`最多只能有 ${LIMITS.customEngines} 个自定义搜索引擎`);
  const engines = value.map(parseCustomEngine);
  if (new Set(engines.map((engine) => engine.id)).size !== engines.length) fail('自定义搜索引擎标识重复');
  return engines;
}

function validateClockSettings(value: unknown): AppSettings['clock'] {
  const clock = asRecord(value, '时钟设置');
  return {
    format: chooseSettingValue(clock.format, CLOCK_FORMATS, '时钟'),
    size: chooseSettingValue(clock.size, CLOCK_SIZES, '时钟大小'),
    showSeconds: booleanSetting(clock.showSeconds, '显示秒数'),
    showDate: booleanSetting(clock.showDate, '显示日期'),
    showWeekday: booleanSetting(clock.showWeekday, '显示星期'),
    dateFormat: chooseSettingValue(clock.dateFormat, DATE_FORMATS, '日期格式'),
    weekdayFormat: chooseSettingValue(clock.weekdayFormat, WEEKDAY_FORMATS, '星期格式'),
  };
}

function validateSearchPreferences(value: unknown): SearchPreferences {
  const search = asRecord(value, '搜索设置');
  return {
    width: chooseSettingValue(search.width, SEARCH_WIDTHS, '搜索框宽度'),
    autoFocus: booleanSetting(search.autoFocus, '搜索自动聚焦'),
    openTarget: chooseSettingValue(search.openTarget, OPEN_TARGETS, '搜索打开方式'),
  };
}

function validateShortcutPreferences(value: unknown): ShortcutPreferences {
  const shortcuts = asRecord(value, '网站显示设置');
  return {
    showNames: booleanSetting(shortcuts.showNames, '网站名称显示'),
    openTarget: chooseSettingValue(shortcuts.openTarget, OPEN_TARGETS, '网站打开方式'),
  };
}

/**
 * 校验设置对象并返回规范化副本。
 *
 * 只读取已知字段，忽略额外键（设置行自身带有 id 等存储字段）；
 * 备份文件的未知字段检查由备份校验单独负责。
 */
export function validateSettings(value: unknown): AppSettings {
  const raw = asRecord(value, '设置');

  const search = asRecord(raw.search, '搜索设置');
  if (typeof search.defaultEngineId !== 'string' || search.defaultEngineId.trim() === '') {
    fail('默认搜索引擎不正确');
  }
  const customEngines = validateCustomEngines(search.customEngines);
  if (!resolveEngine(search.defaultEngineId, customEngines)) {
    fail('默认搜索引擎不存在');
  }

  const searchPreferences = validateSearchPreferences(search);
  return {
    appearance: validateAppearance(raw.appearance),
    search: { defaultEngineId: search.defaultEngineId, customEngines, ...searchPreferences },
    shortcuts: validateShortcutPreferences(raw.shortcuts),
    layout: validateLayout(raw.layout),
    clock: validateClockSettings(raw.clock),
  };
}
