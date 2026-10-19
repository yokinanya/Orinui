import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/domain/settings';
import { BACKUP_VERSION, parseBackup } from '@/domain/backup';

function backup(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: BACKUP_VERSION,
    exportedAt: '2026-10-10T00:00:00.000Z',
    folders: [{ id: 'main', name: '常用', order: 0 }],
    shortcuts: [], settings: createDefaultSettings(), assets: [], ...overrides,
  };
}

const metadata = (values: Record<string, unknown> = {}) => ({
  id: 'a', kind: 'icon', mime: 'image/png', width: 10, height: 10, sourceUrl: null, name: null,
  motion: null, byteLength: 4, sha256: '0'.repeat(64), ...values,
});

describe('ZIP backup manifest', () => {
  it('validates a complete manifest and returns its replacement preview', () => {
    expect(parseBackup(backup())).toMatchObject({ folderCount: 1, shortcutCount: 0, assetCount: 0, engine: 'Google' });
  });

  it.each([
    [{ folders: 'none' }, /文件夹数量/],
    [{ folders: [{ id: 'main', name: ' 常用', order: 0 }] }, /规范格式/],
    [{ unknown: true }, /字段/],
    [{ formatVersion: 1 }, /版本/],
    [{ shortcuts: [{ id: 's', folderId: 'missing', title: '站点', url: 'https://example.com', icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }] }, /所属文件夹/],
    [{ shortcuts: [{ id: 's', folderId: 'main', title: '站点', url: 'https://example.com', icon: { kind: 'asset', assetId: 'missing' }, iconSourceUrl: null, order: 0 }] }, /引用不存在/],
    [{ assets: [{ ...metadata(), sha256: 'bad' }] }, /摘要格式/],
    [{ assets: [{ ...metadata(), byteLength: 0 }] }, /媒体大小/],
  ] as const)('rejects invalid manifests', (overrides, message) => {
    expect(() => parseBackup(backup(overrides))).toThrow(message);
  });

  it('preserves built-in icon references', () => {
    const value = backup({ shortcuts: [{ id: 's', folderId: 'main', title: '站点', url: 'https://example.com',
      icon: { kind: 'built-in', iconId: 'heart' }, iconSourceUrl: null, order: 0 }] });
    expect(parseBackup(value).document.shortcuts[0]?.icon).toEqual({ kind: 'built-in', iconId: 'heart' });
  });

  it('permits icon color only for referenced SVG assets', () => {
    const shortcut = { id: 's', folderId: 'main', title: '站点', url: 'https://example.com',
      icon: { kind: 'asset', assetId: 'a', color: '#12abef' }, iconSourceUrl: null, order: 0 };
    const asset = metadata({ mime: 'image/svg+xml' });
    expect(parseBackup(backup({ shortcuts: [shortcut], assets: [asset] })).document.shortcuts[0]?.icon)
      .toMatchObject({ color: '#12abef' });
    expect(() => parseBackup(backup({ shortcuts: [shortcut], assets: [metadata()] }))).toThrow(/只能用于 SVG/);
    expect(() => parseBackup(backup({ assets: [metadata({ kind: 'background', mime: 'image/svg+xml' })] })))
      .toThrow(/SVG 不能作为背景/);
  });

});

describe('ZIP media and settings validation', () => {
  it('validates motion metadata against background settings and MIME', () => {
    const settings = createDefaultSettings();
    const motionSettings = { ...settings, appearance: { ...settings.appearance,
      background: { kind: 'motion', assetId: 'video', maskStrength: 0.5 } } };
    const video = metadata({ id: 'video', kind: 'background', mime: 'video/mp4', width: 1920, height: 1080,
      motion: { kind: 'video', duration: 2 } });
    expect(parseBackup(backup({ settings: motionSettings, assets: [video] })).assetCount).toBe(1);
    expect(() => parseBackup(backup({ settings: motionSettings, assets: [metadata({ ...video, mime: 'image/gif' })] })))
      .toThrow(/MIME/);
    expect(() => parseBackup(backup({ settings: motionSettings,
      assets: [metadata({ ...video, motion: { kind: 'video', duration: null } })] }))).toThrow(/时长/);
    expect(() => parseBackup(backup({ settings: motionSettings,
      assets: [metadata({ ...video, mime: 'image/gif', motion: { kind: 'animation', duration: 2 } })] })))
      .toThrow(/动图不保存/);
  });

  it('rejects malformed nested settings and duplicate built-in engine ids', () => {
    const settings = createDefaultSettings();
    expect(() => parseBackup(backup({ settings: { ...settings, clock: {} } }))).toThrow();
    expect(() => parseBackup(backup({ settings: { ...settings, search: { ...settings.search,
      customEngines: [{ id: 'google', name: '坏数据', template: 'https://example.com?q={query}', builtIn: false }] } } })))
      .toThrow(/内置标识/);
  });
});

describe('ZIP folder format boundary', () => {
  it('round-trips a folder v9 manifest', () => {
    const parsed = parseBackup(backup({ folders: [{ id: 'work', name: '工作', order: 0 }],
      shortcuts: [{ id: 'site', folderId: 'work', title: '文档', url: 'https://example.com/',
        icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }] }));
    expect(parsed.document.folders).toEqual([{ id: 'work', name: '工作', order: 0 }]);
    expect(parsed.document.shortcuts[0]?.folderId).toBe('work');
  });

  it('upgrades a strict folder v8 backup with defaults and preserves named assets', () => {
    const defaults = createDefaultSettings();
    const { customization: _customization, ...legacySearch } = defaults.search;
    const legacy = backup({ formatVersion: 8, settings: { ...defaults, search: legacySearch },
      assets: [metadata({ kind: 'background', name: '城市夜景' })] });
    const parsed = parseBackup(legacy);
    expect(parsed.document.formatVersion).toBe(BACKUP_VERSION);
    expect(parsed.document.settings.search.customization).toEqual(defaults.search.customization);
    expect(parsed.document.assets[0]?.name).toBe('城市夜景');
  });

  it.each([2, 3, 4, 5, 6, 7])('rejects old group ZIP formatVersion %s without mapping or clearing', (formatVersion) => {
    const legacy = { formatVersion, exportedAt: '2026-10-10T00:00:00.000Z',
      groups: [{ id: 'main', name: '常用', colorRole: 'primary', order: 0, isDefault: true }],
      shortcuts: [], settings: createDefaultSettings(), assets: [] };
    expect(() => parseBackup(legacy)).toThrow(/清单字段不正确/);
  });

  it('keeps the saved media name in the current format', () => {
    const parsed = parseBackup(backup({ assets: [metadata({ kind: 'background', name: '城市夜景' })] }));
    expect(parsed.document.assets).toMatchObject([{ id: 'a', name: '城市夜景' }]);
  });
});


it('preserves same-named folders as independent backup identities', () => {
  const folders = [{ id: 'work-a', name: '工作', order: 0 }, { id: 'work-b', name: '工作', order: 1 }];
  expect(parseBackup(backup({ folders })).document.folders).toEqual(folders);
});
