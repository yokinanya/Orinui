import { describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT, validateLayout, visibleSlots } from '@/domain/layout';

describe('validateLayout', () => {
  it('接受默认布局并返回副本', () => {
    const result = validateLayout({ order: ['clock', 'search', 'shortcuts'], hidden: [] });
    expect(result.order).toEqual(['clock', 'search', 'shortcuts']);
    expect(result.hidden).toEqual([]);
    expect(result).not.toBe(DEFAULT_LAYOUT);
  });

  it('按给定顺序返回区域', () => {
    const result = validateLayout({ order: ['shortcuts', 'clock', 'search'], hidden: [] });
    expect(result.order).toEqual(['shortcuts', 'clock', 'search']);
  });

  it('拒绝缺少已知区域的顺序', () => {
    expect(() => validateLayout({ order: ['clock', 'search'], hidden: [] })).toThrowError(
      /必须恰好包含全部固定区域/,
    );
  });

  it('拒绝重复区域', () => {
    expect(() =>
      validateLayout({ order: ['clock', 'clock', 'search'], hidden: [] }),
    ).toThrowError(/必须恰好包含全部固定区域/);
  });

  it('拒绝未知的隐藏项', () => {
    expect(() =>
      validateLayout({ order: ['clock', 'search', 'shortcuts'], hidden: ['weather'] }),
    ).toThrowError(/未知区域/);
  });

  it('拒绝重复隐藏项', () => {
    expect(() =>
      validateLayout({ order: ['clock', 'search', 'shortcuts'], hidden: ['search', 'search'] }),
    ).toThrowError(/不能重复/);
  });

  it('拒绝缺少数组字段的对象', () => {
    expect(() => validateLayout({ order: ['clock', 'search', 'shortcuts'] })).toThrowError(
      /缺少顺序或隐藏项/,
    );
    expect(() => validateLayout(null)).toThrowError(/格式不正确/);
  });
});

describe('visibleSlots', () => {
  it('过滤被隐藏的区域', () => {
    expect(
      visibleSlots({ order: ['clock', 'search', 'shortcuts'], hidden: ['search'] }),
    ).toEqual(['clock', 'shortcuts']);
  });

  it('全部隐藏时返回空数组', () => {
    expect(
      visibleSlots({ order: ['clock', 'search', 'shortcuts'], hidden: ['clock', 'search', 'shortcuts'] }),
    ).toEqual([]);
  });
});
