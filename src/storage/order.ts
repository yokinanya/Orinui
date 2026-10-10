/**
 * 排序位置维护。
 *
 * 位置使用从 0 开始的连续整数：读取时按 order 升序，
 * 写入时在同一个事务内重排，避免出现空洞或重复位置。
 */
export interface Ordered {
  order: number;
}

/** 排序实体都带稳定标识，拖动排序按标识定位而不是按渲染下标。 */
export interface Identified extends Ordered {
  id: string;
}

export function byOrder<T extends Ordered>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order);
}

/** 追加到末尾时应使用的位置值。 */
export function nextOrder(items: readonly Ordered[]): number {
  return items.reduce((max, item) => (item.order >= max ? item.order + 1 : max), 0);
}

/** 按当前数组下标重新编号；位置已正确时保留原对象引用。 */
export function assignOrder<T extends Ordered>(items: T[]): T[] {
  return items.map((item, index) => (item.order === index ? item : { ...item, order: index }));
}

/** 按 order 排序后重新编号。 */
export function renumber<T extends Ordered>(items: T[]): T[] {
  return assignOrder(byOrder(items));
}

/** 计算相邻位置的下标；越界时返回 null，调用方据此忽略移动。 */
export function targetIndex(index: number, direction: 'up' | 'down', length: number): number | null {
  if (index < 0 || index >= length) return null;

  const next = direction === 'up' ? index - 1 : index + 1;
  return next < 0 || next >= length ? null : next;
}

/**
 * 把指定元素移动到目标下标并重新编号，用于拖动排序。
 *
 * 目标下标会收敛到有效范围。标识不存在或位置未发生变化时返回 null，
 * 调用方据此跳过写入，而不是产生一次没有意义的更新。
 */
export function moveTo<T extends Identified>(items: T[], id: string, index: number): T[] | null {
  const ordered = byOrder(items);
  const from = ordered.findIndex((entry) => entry.id === id);
  const item = ordered[from];
  if (!item) return null;

  const to = Math.min(Math.max(index, 0), ordered.length - 1);
  if (from === to) return null;

  const moved = [...ordered];
  moved.splice(from, 1);
  moved.splice(to, 0, item);
  return assignOrder(moved);
}

/** 交换两个元素的 order 值。 */
export function swap<T extends Ordered>(items: T[], a: number, b: number): T[] {
  const first = items[a];
  const second = items[b];
  if (!first || !second) return items;

  return items.map((item, index) => {
    if (index === a) return { ...item, order: second.order };
    if (index === b) return { ...item, order: first.order };
    return item;
  });
}
