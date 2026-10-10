/**
 * 主页固定插槽。
 *
 * 数据契约 §4：只允许这三个已知标识，顺序与隐藏状态分别持久化。
 * 新增组件或任意坐标布局不在首版范围内。
 */

import { fail } from '@/domain/errors';

export const SLOT_IDS = ['clock', 'search', 'shortcuts'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

export interface LayoutConfig {
  /** 区域自上而下的显示顺序 */
  order: SlotId[];
  /** 被用户隐藏的区域 */
  hidden: SlotId[];
}

export const DEFAULT_LAYOUT: LayoutConfig = {
  order: [...SLOT_IDS],
  hidden: [],
};

export function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value);
}

/** 按配置返回实际需要渲染的区域，隐藏的区域被过滤掉。 */
export function visibleSlots(layout: LayoutConfig): SlotId[] {
  return layout.order.filter((slot) => !layout.hidden.includes(slot));
}

/**
 * 校验布局配置。
 *
 * 数据契约 §4：只允许三个已知标识，顺序必须完整且不重复，隐藏项必须是已知标识的子集。
 */
export function validateLayout(value: unknown): LayoutConfig {
  if (typeof value !== 'object' || value === null) {
    fail('布局设置格式不正确');
  }

  const raw = value as { order?: unknown; hidden?: unknown };

  if (!Array.isArray(raw.order) || !Array.isArray(raw.hidden)) {
    fail('布局设置缺少顺序或隐藏项');
  }

  const order = raw.order as unknown[];
  if (order.length !== SLOT_IDS.length || !SLOT_IDS.every((slot) => order.includes(slot))) {
    fail('布局顺序必须恰好包含全部固定区域且不重复');
  }

  const hidden: SlotId[] = [];
  for (const item of raw.hidden as unknown[]) {
    if (typeof item !== 'string' || !isSlotId(item)) {
      fail('布局隐藏项包含未知区域');
    }
    if (hidden.includes(item)) {
      fail('布局隐藏项不能重复');
    }
    hidden.push(item);
  }

  return { order: [...SLOT_IDS].sort((a, b) => order.indexOf(a) - order.indexOf(b)), hidden };
}

