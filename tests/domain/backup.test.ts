import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from '@/domain/settings';
import { toPortableSettings } from '@/domain/backup-settings';
import { BACKUP_VERSION, parseBackup } from '@/domain/backup';

/** 当前格式的 ZIP 清单：设置整块不含 `bookmarks`，文件夹是带 `parentId` 的树。 */
function backup(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: BACKUP_VERSION,
    exportedAt: '2026-10-10T00:00:00.000Z',
    folders: [{ id: 'main', parentId: null, name: '常用', order: 0 }],
    shortcuts: [], settings: toPortableSettings(createDefaultSettings()), assets: [], ...overrides,
  };
}

/**
 * 扁平文件夹时代的清单：只接受 `id/name/order`，设置里没有 `bookmarks`。
 *
 * 各版本的搜索自定义形状不同：v8 没有 `customization`，v9 的 `customization` 没有
 * `engineOverrides`，v10 起才是当前形状。历史夹具必须按当时的 wire 形状构造。
 */
function legacyBackup(formatVersion: 8 | 9 | 10 | 11, overrides: Record<string, unknown> = {}) {
  const portable = toPortableSettings(createDefaultSettings());
  const legacySearch = formatVersion === 8
    ? (({ customization: _customization, ...rest }) => rest)(portable.search)
    : formatVersion === 9
      ? { ...portable.search, customization: (({ engineOverrides: _engineOverrides, ...rest }) => rest)(portable.search.customization) }
      : portable.search;
  return {
    formatVersion,
    exportedAt: '2026-10-10T00:00:00.000Z',
    folders: [{ id: 'main', name: '常用', order: 0 }],
    shortcuts: [], settings: { ...portable, search: legacySearch }, assets: [], ...overrides,
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

  it('rejects a manifest carrying a bookmarks block', () => {
    const settings = toPortableSettings(createDefaultSettings());
    expect(() => parseBackup(backup({ settings: { ...settings, bookmarks: createDefaultSettings().bookmarks } })))
      .toThrow(/设置字段不正确/);
  });

  it('rejects browser bookmark ids or paths smuggled into the manifest', () => {
    const settings = toPortableSettings(createDefaultSettings());
    expect(() => parseBackup(backup({ settings: { ...settings, bookmarks: {
      enabled: true, mode: 'region', showInSearch: true,
      hiddenRules: [{ ruleId: 'r1', targetId: 'node-1', path: ['书签栏'], kind: 'root', hidden: true, updatedAt: 1 }],
    } } }))).toThrow(/设置字段不正确/);
    expect(() => parseBackup({ ...backup(), folders: [{ id: 'main', parentId: 'node-1', name: '常用', order: 0 }] }))
      .toThrow(/父文件夹|父引用/);
  });

  it.each([
    [{ folders: 'none' }, /文件夹数量/],
    [{ folders: [{ id: 'main', parentId: null, name: ' 常用', order: 0 }] }, /规范格式/],
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
    const settings = toPortableSettings(createDefaultSettings());
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
    const settings = toPortableSettings(createDefaultSettings());
    expect(() => parseBackup(backup({ settings: { ...settings, clock: {} } }))).toThrow();
    expect(() => parseBackup(backup({ settings: { ...settings, search: { ...settings.search,
      customEngines: [{ id: 'google', name: '坏数据', template: 'https://example.com?q={query}', builtIn: false }] } } })))
      .toThrow(/内置标识/);
  });
});

describe('ZIP folder format boundary', () => {
  it('upgrades a strict flat folder v9 manifest with parentId: null and keeps ids', () => {
    const parsed = parseBackup(legacyBackup(9, {
      shortcuts: [{ id: 'site', folderId: 'main', title: '文档', url: 'https://example.com/',
        icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }],
    }));
    expect(parsed.document.folders).toEqual([{ id: 'main', parentId: null, name: '常用', order: 0 }]);
    expect(parsed.document.shortcuts[0]?.folderId).toBe('main');
  });

  it('round-trips a nested current-format manifest', () => {
    const parsed = parseBackup(backup({
      folders: [
        { id: 'work', parentId: null, name: '工作', order: 0 },
        { id: 'docs', parentId: 'work', name: '文档', order: 0 },
      ],
      shortcuts: [{ id: 'site', folderId: 'docs', title: '站点', url: 'https://example.com/',
        icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }],
    }));
    expect(parsed.document.folders).toEqual([
      { id: 'work', parentId: null, name: '工作', order: 0 },
      { id: 'docs', parentId: 'work', name: '文档', order: 0 },
    ]);
    expect(parsed.document.shortcuts[0]?.folderId).toBe('docs');
  });

  it('rejects current manifests with a dangling parent or a folder cycle', () => {
    expect(() => parseBackup(backup({ folders: [{ id: 'work', parentId: 'missing', name: '工作', order: 0 }] })))
      .toThrow(/父引用不存在/);
    expect(() => parseBackup(backup({ folders: [
      { id: 'a', parentId: 'b', name: 'A', order: 0 },
      { id: 'b', parentId: 'a', name: 'B', order: 0 },
    ] }))).toThrow(/成环/);
  });

  it('upgrades a strict folder v8 backup with defaults and preserves named assets', () => {
    const defaults = createDefaultSettings();
    const { customization: _customization, ...legacySearch } = toPortableSettings(defaults).search;
    const legacy = legacyBackup(8, { settings: { ...toPortableSettings(defaults), search: legacySearch },
      assets: [metadata({ kind: 'background', name: '城市夜景' })] });
    const parsed = parseBackup(legacy);
    expect(parsed.document.formatVersion).toBe(BACKUP_VERSION);
    expect(parsed.document.settings.search.customization).toEqual(defaults.search.customization);
    expect(parsed.document.assets[0]?.name).toBe('城市夜景');
  });

  it('upgrades strict ZIP v9 search settings by adding empty built-in engine overrides', () => {
    const defaults = createDefaultSettings();
    const portable = toPortableSettings(defaults);
    const { engineOverrides: _engineOverrides, ...oldCustomization } = portable.search.customization;
    const legacy = legacyBackup(9, { settings: { ...portable, search: { ...portable.search,
      customization: oldCustomization } } });
    const parsed = parseBackup(legacy);
    expect(parsed.document.formatVersion).toBe(BACKUP_VERSION);
    expect(parsed.document.settings.search.customization.engineOverrides).toEqual({});
  });

  it.each([2, 3, 4, 5, 6, 7])('rejects old group ZIP formatVersion %s without mapping or clearing', (formatVersion) => {
    const legacy = { formatVersion, exportedAt: '2026-10-10T00:00:00.000Z',
      groups: [{ id: 'main', name: '常用', colorRole: 'primary', order: 0, isDefault: true }],
      shortcuts: [], settings: toPortableSettings(createDefaultSettings()), assets: [] };
    expect(() => parseBackup(legacy)).toThrow(/清单字段不正确/);
  });

  it('keeps the saved media name in the current format', () => {
    const parsed = parseBackup(backup({ assets: [metadata({ kind: 'background', name: '城市夜景' })] }));
    expect(parsed.document.assets).toMatchObject([{ id: 'a', name: '城市夜景' }]);
  });
});


it('preserves same-named folders as independent backup identities', () => {
  const folders = [{ id: 'work-a', parentId: null, name: '工作', order: 0 },
    { id: 'work-b', parentId: null, name: '工作', order: 1 }];
  expect(parseBackup(backup({ folders })).document.folders).toEqual(folders);
});

describe('ZIP order fidelity for sparse and tied same-layer positions', () => {
  const site = (id: string, order: number, folderId: string | null = null) => ({ id, folderId,
    title: id, url: `https://${id}.example/`, icon: { kind: 'letter' as const }, iconSourceUrl: null, order });

  it('accepts the sparse folder order left by a legitimate local delete', () => {
    // 删除只提升被删项，不重编号目标层既有项：顶层留下 0、2 是合法持久状态。
    const folders = [
      { id: 'work', parentId: null, name: '工作', order: 0 },
      { id: 'fun', parentId: null, name: '娱乐', order: 2 },
    ];
    expect(parseBackup(backup({ folders })).document.folders).toEqual(folders);
  });

  it('accepts tied folder orders that sync materialisation legitimately preserves', () => {
    const folders = [
      { id: 'work', parentId: null, name: '工作', order: 0 },
      { id: 'fun', parentId: null, name: '娱乐', order: 2 },
      { id: 'tie-a', parentId: null, name: '并列A', order: 2 },
      { id: 'nest', parentId: 'work', name: '嵌套', order: 0 },
    ];
    const parsed = parseBackup(backup({ folders }));
    // 原值、原父引用、原标识全部保留，不做规范化或重编号。
    expect(parsed.document.folders).toEqual(folders);
    // 读取显示顺序稳定：同层先 order，其次 id。
    const roots = parsed.document.folders.filter(({ parentId }) => parentId === null)
      .toSorted((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    expect(roots.map(({ id }) => id)).toEqual(['work', 'fun', 'tie-a']);
  });

  it('accepts sparse and tied shortcut orders in one container', () => {
    const folders = [{ id: 'main', parentId: null, name: '常用', order: 0 }];
    const shortcuts = [site('s-a', 0, 'main'), site('s-b', 3, 'main'), site('s-c', 3, 'main')];
    expect(parseBackup(backup({ folders, shortcuts })).document.shortcuts).toEqual(shortcuts);
  });

  it('keeps the tied order deterministic when serialised and parsed again', () => {
    const folders = [
      { id: 'work', parentId: null, name: '工作', order: 0 },
      { id: 'fun', parentId: null, name: '娱乐', order: 2 },
      { id: 'tie-a', parentId: null, name: '并列A', order: 2 },
    ];
    const shortcuts = [site('s-a', 0), site('s-b', 2), site('s-c', 2)];
    const wire = JSON.parse(JSON.stringify(backup({ folders, shortcuts })));
    const first = parseBackup(wire).document;
    const second = parseBackup(JSON.parse(JSON.stringify(wire))).document;
    expect(first.folders).toEqual(folders);
    expect(first.shortcuts).toEqual(shortcuts);
    expect(second).toEqual(first);
  });

  it('still rejects negative or fractional orders and duplicate identifiers', () => {
    expect(() => parseBackup(backup({ folders: [{ id: 'work', parentId: null, name: '工作', order: -1 }] })))
      .toThrow(/文件夹顺序不正确/);
    expect(() => parseBackup(backup({ folders: [{ id: 'work', parentId: null, name: '工作', order: 1.5 }] })))
      .toThrow(/文件夹顺序不正确/);
    expect(() => parseBackup(backup({ shortcuts: [site('s-a', -1)] }))).toThrow(/网站顺序不正确/);
    expect(() => parseBackup(backup({ shortcuts: [site('s-a', 0.5)] }))).toThrow(/网站顺序不正确/);
    expect(() => parseBackup(backup({ folders: [
      { id: 'dup', parentId: null, name: '一', order: 0 },
      { id: 'dup', parentId: null, name: '二', order: 1 },
    ] }))).toThrow(/文件夹标识不能重复/);
    expect(() => parseBackup(backup({ shortcuts: [site('s-a', 0), site('s-a', 1)] })))
      .toThrow(/网站标识重复/);
  });

  it('reads the committed ZIP 11 shape as the historical flat list, not a parentId tree', () => {
    // 证据：已提交的 Beta 2（HEAD）里 CURRENT_BACKUP_VERSION = 11，且 folders 条目只有
    // id/name/order、order 必须等于数组下标；parentId 是 12 才开始的形状。
    const legacy = legacyBackup(11);
    const parsed = parseBackup(legacy);
    expect(parsed.document.folders).toEqual([{ id: 'main', parentId: null, name: '常用', order: 0 }]);
    // 带 parentId 的条目不属于 11 的历史形状，继续明确拒绝而不是当作树读。
    expect(() => parseBackup({ ...legacy, folders: [{ id: 'main', parentId: null, name: '常用', order: 0 }] }))
      .toThrow(/文件夹字段不正确/);
    // 11 仍沿用旧的连续顺序合同：扁平列表外不可能出现空洞。
    expect(() => parseBackup({ ...legacy, folders: [
      { id: 'main', name: '常用', order: 0 },
      { id: 'other', name: '其他', order: 2 },
    ] })).toThrow(/文件夹顺序不正确/);
    // 网站的旧合同同样保留：扁平时代每次删除都会重排，稀疏或并列都不属于历史形状。
    const legacyWithSite = (order: number) => ({ ...legacy, shortcuts: [
      { id: 's', folderId: null, title: '站点', url: 'https://example.com/', icon: { kind: 'letter' },
        iconSourceUrl: null, order }] });
    expect(parseBackup(legacyWithSite(0)).document.shortcuts[0]?.order).toBe(0);
    expect(() => parseBackup(legacyWithSite(2))).toThrow(/网站顺序必须连续/);
  });
});
