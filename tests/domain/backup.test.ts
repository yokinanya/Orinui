import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/domain/settings';
import { parseBackup } from '@/domain/backup';

function backup(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    exportedAt: '2026-10-10T00:00:00.000Z',
    groups: [{ id: 'main', name: '常用', colorRole: 'primary', order: 0, isDefault: true }],
    shortcuts: [],
    settings: createDefaultSettings(),
    assets: [],
    ...overrides,
  };
}

describe('parseBackup', () => {
  it('validates a complete backup and returns its replacement preview', () => {
    const preview = parseBackup(backup());
    expect(preview).toMatchObject({ groupCount: 1, shortcutCount: 0, assetCount: 0, defaultGroup: '常用', engine: 'Google' });
  });
  it.each([
    [{ groups: [] }, /分组数量/],
    [{ groups: [{ id: 'main', name: '常用', colorRole: 'primary', order: 0, isDefault: false }] }, /恰好/],
    [{ unknown: true }, /字段/],
    [{ version: 2 }, /版本/],
    [{ shortcuts: [{ id: 's', groupId: 'missing', title: '站点', url: 'https://example.com', icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }] }, /所属分组/],
    [{ shortcuts: [{ id: 's', groupId: 'main', title: '站点', url: 'https://example.com', icon: { kind: 'asset', assetId: 'missing' }, iconSourceUrl: null, order: 0 }] }, /引用不存在/],
    [{ assets: [{ id: 'a', kind: 'icon', mime: 'image/png', width: 1, height: 1, sourceUrl: null, data: 'not base64' }] }, /Base64/],
  ] as const)('rejects invalid backup contents', (overrides, message) => {
    expect(() => parseBackup(backup(overrides))).toThrow(message);
  });
  it('preserves custom built-in icon references and validates their asset relationships', () => {
    const value = backup({
      shortcuts: [{ id: 's', groupId: 'main', title: '站点', url: 'https://example.com', icon: { kind: 'built-in', iconId: 'heart' }, iconSourceUrl: null, order: 0 }],
    });
    expect(parseBackup(value).document.shortcuts[0]?.icon).toEqual({ kind: 'built-in', iconId: 'heart' });
  });
  it('permits icon color only when the referenced backup asset is SVG', () => {
    const shortcut = { id: 's', groupId: 'main', title: '站点', url: 'https://example.com',
      icon: { kind: 'asset', assetId: 'a', color: '#12abef' }, iconSourceUrl: null, order: 0 };
    const asset = { id: 'a', kind: 'icon', mime: 'image/svg+xml', width: 10, height: 10,
      sourceUrl: null, data: 'PHN2Zz4=' };
    expect(parseBackup(backup({ shortcuts: [shortcut], assets: [asset] })).document.shortcuts[0]?.icon)
      .toMatchObject({ color: '#12abef' });
    expect(() => parseBackup(backup({ shortcuts: [shortcut], assets: [{ ...asset, mime: 'image/png' }] })))
      .toThrow(/只能用于 SVG/);
    expect(() => parseBackup(backup({ assets: [{ ...asset, kind: 'background' }] })))
      .toThrow(/SVG 不能作为背景/);
  });
  it('rejects omitted nested settings and duplicate built-in search engine ids', () => {
    const settings = createDefaultSettings();
    expect(() => parseBackup(backup({ settings: { ...settings, clock: {} } })).document).toThrow();
    expect(() => parseBackup(backup({ settings: { ...settings, search: {
      ...settings.search, customEngines: [{ id: 'google', name: '坏数据', template: 'https://example.com?q={query}', builtIn: false }],
    } } }))).toThrow(/内置标识/);
  });
});
