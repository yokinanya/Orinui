import { describe, expect, it } from 'vitest';

import { moveTo, type Identified } from '@/storage/order';

function items(...ids: string[]): Identified[] {
  return ids.map((id, order) => ({ id, order }));
}

/** 同时断言顺序与编号，避免只验证其中一半。 */
function layout(list: Identified[]): string[] {
  return list.map((item) => `${item.id}#${item.order}`);
}

/** 断言确实发生移动后再取结果，避免用例静默通过。 */
function afterMove(list: Identified[], id: string, index: number): Identified[] {
  const result = moveTo(list, id, index);
  if (!result) throw new Error('预期发生移动，实际返回 null');
  return result;
}

describe('moveTo', () => {
  it('把元素移动到目标下标并重新编号', () => {
    expect(layout(afterMove(items('a', 'b', 'c'), 'a', 2))).toEqual(['b#0', 'c#1', 'a#2']);
  });

  it('支持移动到开头', () => {
    expect(layout(afterMove(items('a', 'b', 'c'), 'c', 0))).toEqual(['c#0', 'a#1', 'b#2']);
  });

  it('目标下标越界时收敛到末尾', () => {
    expect(layout(afterMove(items('a', 'b', 'c'), 'a', 99))).toEqual(['b#0', 'c#1', 'a#2']);
  });

  it('目标下标为负时收敛到开头', () => {
    expect(layout(afterMove(items('a', 'b', 'c'), 'c', -5))).toEqual(['c#0', 'a#1', 'b#2']);
  });

  it('位置未变化时返回 null，便于调用方跳过写入', () => {
    expect(moveTo(items('a', 'b', 'c'), 'b', 1)).toBeNull();
  });

  it('标识不存在时返回 null', () => {
    expect(moveTo(items('b', 'a'), 'missing', 0)).toBeNull();
  });

  it('输入顺序错位时先按 order 排序再移动', () => {
    const shuffled: Identified[] = [
      { id: 'c', order: 2 },
      { id: 'a', order: 0 },
      { id: 'b', order: 1 },
    ];

    expect(layout(afterMove(shuffled, 'c', 0))).toEqual(['c#0', 'a#1', 'b#2']);
  });
});
