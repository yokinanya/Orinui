import { describe, expect, it } from 'vitest';

import { DEFAULT_LAYOUT, migrateLegacyLayoutStyle, upgradeSlotOrder, validateLayout, visibleSlots } from '@/domain/layout';

describe('validateLayout', () => {
  it('接受默认布局并返回副本', () => {
    const result = validateLayout({ ...DEFAULT_LAYOUT });
    expect(result.style).toBe('centered');
    expect(result.clockPosition).toBe('left');
    expect(result.order).toEqual(['clock', 'search', 'shortcuts', 'bookmarks']);
    expect(result.hidden).toEqual([]);
    expect(result).not.toBe(DEFAULT_LAYOUT);
    expect(result.order).not.toBe(DEFAULT_LAYOUT.order);
  });

  it('接受左右分区并保留宽度、列数与隐藏偏好', () => {
    const input = { ...DEFAULT_LAYOUT, style: 'split', pageWidth: 'wide', columns: 8, hidden: ['clock'] };
    const result = validateLayout(input);
    expect(result).toEqual(input);
    expect(result.hidden).not.toBe(input.hidden);
  });

  it('按给定顺序返回区域，不重排', () => {
    const result = validateLayout({ ...DEFAULT_LAYOUT, order: ['shortcuts', 'clock', 'search', 'bookmarks'], hidden: [] });
    expect(result.order).toEqual(['shortcuts', 'clock', 'search', 'bookmarks']);
  });

  it('拒绝缺少已知区域的顺序', () => {
    expect(() => validateLayout({ ...DEFAULT_LAYOUT, order: ['clock', 'search', 'shortcuts'], hidden: [] })).toThrowError(
      /必须恰好包含全部固定区域/,
    );
  });

  it('拒绝重复区域', () => {
    expect(() =>
      validateLayout({ ...DEFAULT_LAYOUT, order: ['clock', 'clock', 'search', 'bookmarks'], hidden: [] }),
    ).toThrowError(/必须恰好包含全部固定区域/);
  });

  it('拒绝未知的顺序项', () => {
    expect(() =>
      validateLayout({ ...DEFAULT_LAYOUT, order: ['clock', 'search', 'shortcuts', 'weather'], hidden: [] }),
    ).toThrowError(/未知区域/);
  });

  it('拒绝未知的隐藏项', () => {
    expect(() => validateLayout({ ...DEFAULT_LAYOUT, hidden: ['weather'] })).toThrowError(/未知区域/);
  });

  it('拒绝重复隐藏项', () => {
    expect(() => validateLayout({ ...DEFAULT_LAYOUT, hidden: ['search', 'search'] })).toThrowError(/不能重复/);
  });

  it.each(['unknown', 'center', 'toolbar', 'sidebar', null])('拒绝无效的主页布局样式 %s', (style) => {
    expect(() => validateLayout({ ...DEFAULT_LAYOUT, style })).toThrowError(/页面布局/);
  });

  it.each([
    ['centered', 'centered'], ['toolbar', 'top-search'], ['sidebar', 'left-stack'],
  ])('映射旧布局样式 %s', (legacy, current) => {
    expect(migrateLegacyLayoutStyle(legacy)).toBe(current);
  });

  it('拒绝不认识的时钟角落', () => {
    expect(() => validateLayout({ ...DEFAULT_LAYOUT, clockPosition: 'center' })).toThrowError(/时钟位置/);
  });

});

describe('upgradeSlotOrder', () => {
  it('旧三槽布局只在末尾追加 bookmarks，保留既有相对顺序与隐藏项', () => {
    expect(upgradeSlotOrder(['shortcuts', 'clock', 'search'])).toEqual(['shortcuts', 'clock', 'search', 'bookmarks']);
    expect(upgradeSlotOrder(['clock', 'search', 'shortcuts'])).toEqual(['clock', 'search', 'shortcuts', 'bookmarks']);
  });

  it('已是四槽时原样返回（幂等）', () => {
    const order = ['bookmarks', 'shortcuts', 'clock', 'search'];
    expect(upgradeSlotOrder(order)).toEqual(order);
  });

  it('拒绝未知区域与重复区域', () => {
    expect(() => upgradeSlotOrder(['clock', 'weather'])).toThrowError(/未知区域/);
    expect(() => upgradeSlotOrder(['clock', 'clock'])).toThrowError(/不能重复/);
    expect(() => upgradeSlotOrder('clock')).toThrowError(/格式不正确/);
  });
});

it('拒绝缺少数组字段的对象', () => {
  expect(() => validateLayout({ pageWidth: 'standard', regionSpacing: 'standard', columns: 6,
    order: ['clock', 'search', 'shortcuts', 'bookmarks'] })).toThrowError(/缺少顺序或隐藏项/);
  expect(() => validateLayout(null)).toThrowError(/格式不正确/);
});

describe('visibleSlots', () => {  it('过滤被隐藏的区域', () => {
    expect(
      visibleSlots({ order: ['clock', 'search', 'shortcuts', 'bookmarks'], hidden: ['search'] }),
    ).toEqual(['clock', 'shortcuts', 'bookmarks']);
  });

  it('全部隐藏时返回空数组', () => {
    expect(
      visibleSlots({ order: ['clock', 'search', 'shortcuts', 'bookmarks'], hidden: ['clock', 'search', 'shortcuts', 'bookmarks'] }),
    ).toEqual([]);
  });
});
