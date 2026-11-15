/**
 * 主页固定插槽。
 *
 * 数据契约 §4：固定区域顺序与隐藏状态分别持久化。`bookmarks` 是第四个区域，
 * 旧数据升级统一把它追加到顺序末尾，既有三区相对顺序不变。
 */

import { fail } from '@/domain/errors';
import { asRecord } from '@/domain/validate';

export const SLOT_IDS = ['clock', 'search', 'shortcuts', 'bookmarks'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

/** 区域顺序/显隐之外的布局偏好；不参与区域排序。 */
export interface LayoutPreferences {
  style: HomeLayoutStyle;
  clockPosition: ClockCornerPosition;
  pageWidth: 'compact' | 'standard' | 'wide';
  regionSpacing: 'compact' | 'standard' | 'relaxed';
  columns: 4 | 6 | 8;
}

export const HOME_LAYOUT_STYLES = ['centered', 'top-search', 'left-stack', 'split'] as const;
export type HomeLayoutStyle = (typeof HOME_LAYOUT_STYLES)[number];
export const CLOCK_CORNER_POSITIONS = ['left', 'right'] as const;
export type ClockCornerPosition = (typeof CLOCK_CORNER_POSITIONS)[number];

export interface LayoutConfig extends LayoutPreferences {
  /** 区域自上而下的显示顺序 */
  order: SlotId[];
  /** 被用户隐藏的区域 */
  hidden: SlotId[];
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  style: 'centered',
  clockPosition: 'left',
  order: [...SLOT_IDS],
  hidden: [],
  pageWidth: 'standard',
  regionSpacing: 'standard',
  columns: 6,
};

export function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value);
}

/** 按配置返回实际需要渲染的区域，隐藏的区域被过滤掉。 */
export function visibleSlots(layout: Pick<LayoutConfig, 'order' | 'hidden'>): SlotId[] {
  return layout.order.filter((slot) => !layout.hidden.includes(slot));
}

const PAGE_WIDTHS = ['compact', 'standard', 'wide'] as const;
const REGION_SPACINGS = ['compact', 'standard', 'relaxed'] as const;
const GRID_COLUMNS = [4, 6, 8] as const;

export function migrateLegacyLayoutStyle(value: unknown): HomeLayoutStyle {
  if (value === 'centered') return 'centered';
  if (value === 'toolbar') return 'top-search';
  if (value === 'sidebar') return 'left-stack';
  fail('旧页面布局设置不受支持');
}

function chooseValue<T extends string | number>(value: unknown, options: readonly T[], label: string): T {
  if (!options.includes(value as T)) fail(`${label}设置不正确`);
  return value as T;
}

function validateSlot(value: unknown, label: string): SlotId {
  if (typeof value !== 'string' || !isSlotId(value)) fail(`${label}包含未知区域`);
  return value;
}

/**
 * 旧数据升级：保留既有区域相对顺序，把缺失的区域按默认顺序追加到末尾。
 *
 * 只用于显式迁移（Dexie / 旧同步快照 / 旧 ZIP）；当前格式仍严格要求顺序恰好包含全部区域。
 */
export function upgradeSlotOrder(value: unknown, label = '布局顺序'): SlotId[] {
  if (!Array.isArray(value)) fail(`${label}格式不正确`);
  const order: SlotId[] = [];
  for (const item of value) {
    const slot = validateSlot(item, label);
    if (order.includes(slot)) fail(`${label}不能重复`);
    order.push(slot);
  }
  for (const slot of SLOT_IDS) if (!order.includes(slot)) order.push(slot);
  return order;
}

function validateSlotOrder(value: unknown): SlotId[] {
  const order = (value as unknown[]).map((item) => validateSlot(item, '布局顺序'));
  if (order.length !== SLOT_IDS.length) fail('布局顺序必须恰好包含全部固定区域且不重复');
  if (new Set(order).size !== SLOT_IDS.length) fail('布局顺序必须恰好包含全部固定区域且不重复');
  return order;
}

function validateHiddenSlots(value: unknown): SlotId[] {
  const hidden = (value as unknown[]).map((item) => validateSlot(item, '布局隐藏项'));
  if (new Set(hidden).size !== hidden.length) fail('布局隐藏项不能重复');
  return hidden;
}

/**
 * 校验布局配置。
 *
 * 数据契约 §4：只允许已知区域标识，顺序必须完整且不重复，隐藏项必须是已知标识的子集。
 */
export function validateLayout(value: unknown): LayoutConfig {
  const raw = asRecord(value, '布局设置');
  if (!Array.isArray(raw.order) || !Array.isArray(raw.hidden)) fail('布局设置缺少顺序或隐藏项');
  const order = validateSlotOrder(raw.order);
  const hidden = validateHiddenSlots(raw.hidden);
  return {
    style: chooseValue(raw.style, HOME_LAYOUT_STYLES, '页面布局'),
    clockPosition: chooseValue(raw.clockPosition, CLOCK_CORNER_POSITIONS, '时钟位置'),
    // 用户自定义的区域顺序原样保留；校验只保证集合完整且不重复，不重排。
    order,
    hidden,
    pageWidth: chooseValue(raw.pageWidth, PAGE_WIDTHS, '页面宽度'),
    regionSpacing: chooseValue(raw.regionSpacing, REGION_SPACINGS, '区域间距'),
    columns: chooseValue(raw.columns, GRID_COLUMNS, '网站列数'),
  };
}

export function splitLayout(layout: LayoutConfig): { readonly order: SlotId[]; readonly hidden: SlotId[]; readonly preferences: LayoutPreferences } {
  return {
    order: [...layout.order],
    hidden: [...layout.hidden],
    preferences: { style: layout.style, clockPosition: layout.clockPosition, pageWidth: layout.pageWidth,
      regionSpacing: layout.regionSpacing, columns: layout.columns },
  };
}

/**
 * 按 `LayoutConfig` 的规范字段顺序重建布局对象。
 *
 * 顺序敏感的比较（例如同步里对设置值做 JSON 相等判断）依赖这里与 `validateLayout`
 * 输出相同的键序；不要改成先展开 `preferences`。
 */
export function joinLayout(input: { readonly order: SlotId[]; readonly hidden: SlotId[]; readonly preferences: LayoutPreferences }): LayoutConfig {
  const { preferences } = input;
  return {
    style: preferences.style,
    clockPosition: preferences.clockPosition,
    order: [...input.order],
    hidden: [...input.hidden],
    pageWidth: preferences.pageWidth,
    regionSpacing: preferences.regionSpacing,
    columns: preferences.columns,
  };
}

const LAYOUT_PREFERENCE_KEYS = ['style', 'clockPosition', 'pageWidth', 'regionSpacing', 'columns'] as const;

/** 严格校验拆分后的布局偏好（不含顺序与显隐）。 */
export function validateLayoutPreferences(value: unknown): LayoutPreferences {
  const raw = asRecord(value, '布局偏好');
  if (Object.keys(raw).length !== LAYOUT_PREFERENCE_KEYS.length || !LAYOUT_PREFERENCE_KEYS.every((key) => Object.hasOwn(raw, key))) {
    fail('布局偏好字段不正确');
  }
  return {
    style: chooseValue(raw.style, HOME_LAYOUT_STYLES, '页面布局'),
    clockPosition: chooseValue(raw.clockPosition, CLOCK_CORNER_POSITIONS, '时钟位置'),
    pageWidth: chooseValue(raw.pageWidth, PAGE_WIDTHS, '页面宽度'),
    regionSpacing: chooseValue(raw.regionSpacing, REGION_SPACINGS, '区域间距'),
    columns: chooseValue(raw.columns, GRID_COLUMNS, '网站列数'),
  };
}

export function validateLayoutOrder(value: unknown): SlotId[] {
  if (!Array.isArray(value)) fail('布局顺序格式不正确');
  return validateSlotOrder(value);
}

export function validateLayoutHidden(value: unknown): SlotId[] {
  if (!Array.isArray(value)) fail('布局隐藏项格式不正确');
  return validateHiddenSlots(value);
}
