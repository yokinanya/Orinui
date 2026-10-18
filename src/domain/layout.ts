/**
 * 主页固定插槽。
 *
 * 数据契约 §4：只允许三个固定区域与四种命名布局，顺序与隐藏状态分别持久化。
 */

import { fail } from '@/domain/errors';
import { asRecord } from '@/domain/validate';

export const SLOT_IDS = ['clock', 'search', 'shortcuts'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export const HOME_LAYOUT_STYLES = ['centered', 'top-search', 'left-stack', 'split'] as const;
export type HomeLayoutStyle = (typeof HOME_LAYOUT_STYLES)[number];
export const CLOCK_CORNER_POSITIONS = ['left', 'right'] as const;
export type ClockCornerPosition = (typeof CLOCK_CORNER_POSITIONS)[number];

export interface LayoutConfig {
  /** 主页区域的组合方式。 */
  style: HomeLayoutStyle;
  /** 仅在顶部搜索布局中控制时钟的角落。 */
  clockPosition: ClockCornerPosition;
  /** 区域自上而下的显示顺序 */
  order: SlotId[];
  /** 被用户隐藏的区域 */
  hidden: SlotId[];
  pageWidth: 'compact' | 'standard' | 'wide';
  regionSpacing: 'compact' | 'standard' | 'relaxed';
  columns: 4 | 6 | 8;
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
 * 数据契约 §4：只允许三个已知标识，顺序必须完整且不重复，隐藏项必须是已知标识的子集。
 */
export function validateLayout(value: unknown): LayoutConfig {
  const raw = asRecord(value, '布局设置');
  if (!Array.isArray(raw.order) || !Array.isArray(raw.hidden)) fail('布局设置缺少顺序或隐藏项');
  const order = validateSlotOrder(raw.order);
  const hidden = validateHiddenSlots(raw.hidden);
  return {
    style: chooseValue(raw.style, HOME_LAYOUT_STYLES, '页面布局'),
    clockPosition: chooseValue(raw.clockPosition, CLOCK_CORNER_POSITIONS, '时钟位置'),
    order: [...SLOT_IDS].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    hidden,
    pageWidth: chooseValue(raw.pageWidth, PAGE_WIDTHS, '页面宽度'),
    regionSpacing: chooseValue(raw.regionSpacing, REGION_SPACINGS, '区域间距'),
    columns: chooseValue(raw.columns, GRID_COLUMNS, '网站列数'),
  };
}

