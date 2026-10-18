import { expect, it } from 'vitest';
import { createDefaultAppearance } from '@/domain/appearance';
import { DEFAULT_LAYOUT } from '@/domain/layout';
import { createDefaultSettings } from '@/domain/settings';
import { shortcutIconOccupancy } from '@/domain/shortcut-icon';
import { LEGACY_LAYOUT_SYNC_SCHEMA_VERSION, LEGACY_STYLE_SYNC_SCHEMA_VERSION, LEGACY_SYNC_SCHEMA_VERSION, mergeSyncSnapshots,
  materializeSyncSnapshot, parseSyncSnapshot, PREVIOUS_SYNC_SCHEMA_VERSION, SyncMergeConflictError,
  SYNC_SCHEMA_VERSION } from '@/domain/sync';
import type { SyncRegister, SyncSnapshot } from '@/domain/sync';

function register<T>(value: T, clock = 1, deviceId = 'device-a'): SyncRegister<T> {
  return { value, clock, deviceId };
}

function snapshot(deviceId: string, changes: Partial<SyncSnapshot> = {}): SyncSnapshot {
  const defaults = createDefaultSettings();
  return {
    schemaVersion: SYNC_SCHEMA_VERSION, vaultId: 'vault-1', deviceId, generation: 1,
    folders: [],
    shortcuts: [],
    settings: {
      appearance: register(createDefaultAppearance()), defaultEngineId: register('google'),
      layout: register(DEFAULT_LAYOUT), clock: register(defaults.clock),
      searchPreferences: register({ width: defaults.search.width, autoFocus: defaults.search.autoFocus, openTarget: defaults.search.openTarget }),
      shortcutPreferences: register(defaults.shortcuts), customEngines: [],
    },
    assets: [], tombstones: [], ...changes,
  };
}

function shortcut(input: { readonly title: string; readonly url: string; readonly deviceId: string; readonly clock: number;
  readonly folderId?: string | null }) {
  const { title, url, deviceId, clock, folderId = null } = input;
  return { id: 'shortcut-1', title: register(title, clock, deviceId), url: register(url, clock, deviceId),
    placement: register({ folderId, order: 0 }, clock, deviceId),
    icon: register({ kind: 'letter' } as const, clock, deviceId) };
}

function expectMergeConflict(action: () => unknown, code: string, entityId: string): void {
  let conflict: unknown;
  try { action(); } catch (error) { conflict = error; }
  expect(conflict).toBeInstanceOf(SyncMergeConflictError);
  expect(conflict).toMatchObject({ code, entityId });
}

it('merges independent shortcut fields while same-field conflicts use clock then device id', () => {
  const local = snapshot('device-a', { shortcuts: [{ ...shortcut({ title: 'Local title', url: 'https://example.test/', deviceId: 'device-a', clock: 4 }),
    url: register('https://example.test/', 1, 'device-a') }] });
  const remote = snapshot('device-b', { shortcuts: [{ ...shortcut({ title: 'Title', url: 'https://remote.test/', deviceId: 'device-b', clock: 4 }),
    title: register('Title', 1, 'device-b') }] });
  const merged = mergeSyncSnapshots({ local, remotes: [remote] });
  const [record] = merged.shortcuts;
  if (!record) throw new Error('合并结果缺少网站记录');
  expect(record.title.value).toBe('Local title');
  expect(record.url.value).toBe('https://remote.test/');
  expect(materializeSyncSnapshot(merged).shortcuts[0]).toMatchObject({ title: 'Local title', url: 'https://remote.test/' });
  const tied = mergeSyncSnapshots({ local, remotes: [snapshot('device-z', { shortcuts: [shortcut({ title: 'Later device', url: 'https://later.test/', deviceId: 'device-z', clock: 4 })] })] });
  expect(tied.shortcuts[0]?.title.value).toBe('Later device');
});

it('rejects the pre-beta sync schema without migrating it', () => {
  const current = snapshot('device-a');
  expect(() => parseSyncSnapshot({ ...current, schemaVersion: 1 })).toThrow(/版本不受支持/);
  expect(() => parseSyncSnapshot({ ...current, schemaVersion: 2 })).toThrow(/版本不受支持/);
  expect(() => parseSyncSnapshot({ ...current, schemaVersion: 3 })).toThrow(/版本不受支持/);
});

it.each([4, 5, 6, 7, 8, 9])('rejects legacy group sync schema %s without remote mutation', (schemaVersion) => {
  const current = snapshot('device-a');
  const legacyEnvelope = { ...current, schemaVersion,
    defaultGroupId: register('legacy-default'),
    groups: [{ id: 'legacy-default', name: register('常用'), colorRole: register('primary'), position: register(0) }],
    folders: undefined,
  };
  expect(() => parseSyncSnapshot(legacyEnvelope)).toThrow(/旧分组同步协议|字段不正确/);
});

it('accepts the current folder schema and validates folder references', () => {
  const folder = { id: 'work', name: register('工作'), position: register(0) };
  const site = shortcut({ title: '文档', url: 'https://example.test/', deviceId: 'device-a', clock: 1, folderId: folder.id });
  const parsed = parseSyncSnapshot(snapshot('device-a', { folders: [folder], shortcuts: [site] }));
  expect(parsed.folders).toEqual([folder]);
  expect(parsed.shortcuts[0]?.placement.value.folderId).toBe(folder.id);
});

it.each([4, 5, 6, 7, 8, 9])('rejects old group or intermediate wire schema %s', (schemaVersion) => {
  const legacy = { ...snapshot('device-a'), schemaVersion, defaultGroupId: register('legacy'),
    groups: [{ id: 'legacy', name: register('常用'), colorRole: register('primary'), position: register(0) }] };
  expect(() => parseSyncSnapshot(legacy)).toThrow(/旧分组同步协议/);
});
it.each(['left-stack', 'split'] as const)('merges and materializes layout %s through the layout register', (style) => {
  const base = snapshot('device-a');
  const local = { ...base, settings: { ...base.settings,
    layout: register({ ...base.settings.layout.value, style }, 2, 'device-a') } };
  const remote = snapshot('device-b');
  const parsed = parseSyncSnapshot(local);
  expect(materializeSyncSnapshot(mergeSyncSnapshots({ local: parsed, remotes: [remote] })).settings.layout.style).toBe(style);
});

it('retains unselected background assets in the full synchronized library', () => {
  const wallpaper = { id: 'wallpaper-1', kind: 'background' as const, mime: 'image/png' as const,
    width: 1, height: 1, byteLength: 5, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const local = snapshot('device-a', { assets: [wallpaper] });
  expect(parseSyncSnapshot(local).assets).toEqual([wallpaper]);
  expect(mergeSyncSnapshots({ local, remotes: [] }).assets).toEqual([wallpaper]);
});

it('merges new preference registers independently', () => {
  const local = snapshot('device-a');
  const remote = snapshot('device-b', { settings: {
    ...snapshot('device-b').settings,
    searchPreferences: register({ width: 'wide', autoFocus: true, openTarget: 'new-tab' }, 5, 'device-b'),
    shortcutPreferences: register({ showNames: false, openTarget: 'new-tab' }, 6, 'device-b'),
  } });
  const merged = mergeSyncSnapshots({ local, remotes: [remote] });
  expect(materializeSyncSnapshot(merged).settings.search).toMatchObject({ width: 'wide', autoFocus: true, openTarget: 'new-tab' });
  expect(materializeSyncSnapshot(merged).settings.shortcuts).toEqual({ showNames: false, openTarget: 'new-tab' });
});

it('prefers an entity tombstone to a live replica and rejects the same tombstone beside a live entity', () => {
  const live = snapshot('device-a', { shortcuts: [shortcut({ title: 'Title', url: 'https://example.test/', deviceId: 'device-a', clock: 2 })] });
  const deleted = snapshot('device-b', { tombstones: [{ entityType: 'shortcut', id: 'shortcut-1', clock: 1, deviceId: 'device-b' }] });
  expect(mergeSyncSnapshots({ local: live, remotes: [deleted] }).shortcuts).toEqual([]);
  expect(() => parseSyncSnapshot({ ...live, tombstones: deleted.tombstones })).toThrow(/同时处于存活和删除状态/);
});

it('deleted folder moves an unchanged child to homepage without a shortcut tombstone', () => {
  const folder = { id: 'folder-extra', name: register('额外'), position: register(1) };
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 2, folderId: folder.id });
  const local = snapshot('device-a', { folders: [folder], shortcuts: [child] });
  const deletedFolder = snapshot('device-b', {
    tombstones: [{ entityType: 'folder', id: folder.id, clock: 3, deviceId: 'device-b' }],
  });
  const result = mergeSyncSnapshots({ local, remotes: [deletedFolder] });

  expect(result.folders).toEqual([]);
  expect(result.shortcuts).toHaveLength(1);
  expect(result.shortcuts[0]?.placement).toEqual(child.placement);
  expect(materializeSyncSnapshot(result).shortcuts[0]?.folderId).toBeNull();
  expect(result.tombstones).toContainEqual(expect.objectContaining({ entityType: 'folder', id: folder.id }));
  expect(result.tombstones).not.toContainEqual(expect.objectContaining({ entityType: 'shortcut', id: child.id }));
});

it('permanent folder deletion wins even a newer placement without rewriting the register', () => {
  const folder = { id: 'folder-extra', name: register('额外'), position: register(1) };
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 8, folderId: folder.id });
  const local = snapshot('device-a', { folders: [folder], shortcuts: [child] });
  const deletedFolder = snapshot('device-b', {
    tombstones: [{ entityType: 'folder', id: folder.id, clock: 3, deviceId: 'device-b' }],
  });
  const result = mergeSyncSnapshots({ local, remotes: [deletedFolder] });

  expect(result.folders).toEqual([]);
  expect(result.shortcuts[0]?.placement).toEqual(child.placement);
  expect(materializeSyncSnapshot(result).shortcuts[0]?.folderId).toBeNull();
  expect(result.tombstones).toContainEqual(expect.objectContaining({ entityType: 'folder', id: folder.id }));
});

it('moving a child to homepage wins a newer folder tombstone', () => {
  const folder = { id: 'folder-extra', name: register('额外'), position: register(1) };
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 2, folderId: folder.id });
  const local = snapshot('device-a', { folders: [folder], shortcuts: [child] });
  const deletedFolder = snapshot('device-b', {
    tombstones: [{ entityType: 'folder', id: folder.id, clock: 3, deviceId: 'device-b' }],
  });
  const moved = snapshot('device-c', { shortcuts: [{ ...child,
    placement: register({ folderId: null, order: 0 }, 4, 'device-c') }] });
  const result = mergeSyncSnapshots({ local, remotes: [deletedFolder, moved] });

  expect(result.folders).toEqual([]);
  expect(result.shortcuts[0]?.placement.value.folderId).toBeNull();
});

it('derives contiguous deterministic positions without changing register clocks', () => {
  const folders = [
    { id: 'g2', name: register('二'), position: register(0, 2, 'device-b') },
    { id: 'folder-default', name: register('常用'), position: register(0) },
  ];
  const merged = mergeSyncSnapshots({ local: snapshot('device-a', { folders }), remotes: [] });
  expect(materializeSyncSnapshot(merged).folders.map(({ id, order }) => [id, order])).toEqual([['g2', 0], ['folder-default', 1]]);
  expect(merged.folders.find(({ id }) => id === 'g2')?.position.clock).toBe(2);
});

it('rejects removed group wire schemas, unknown versions and malformed references', () => {
  const valid = snapshot('device-a');
  expect(() => parseSyncSnapshot({ ...valid, schemaVersion: SYNC_SCHEMA_VERSION + 1 })).toThrow(/版本不受支持/);
  expect(() => parseSyncSnapshot({ ...valid, schemaVersion: 4 })).toThrow(/旧分组同步协议/);
  expect(() => parseSyncSnapshot({ ...valid, schemaVersion: 9 })).toThrow(/旧分组同步协议/);
  expect(() => parseSyncSnapshot({ ...valid, extra: true })).toThrow(/字段不正确/);
  const folderId = (value: string) => ({ ...shortcut({ title: 'Title', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    placement: register({ folderId: value, order: 0 }) });
  expect(() => parseSyncSnapshot({ ...valid, shortcuts: [folderId('missing')] }))
    .toThrow(/所属文件夹引用不存在/);
  const folders = Array.from({ length: 51 }, (_, index) => ({ id: `folder-${index}`, name: register(`文件夹${index}`),
    position: register(index) }));
  expect(() => parseSyncSnapshot({ ...valid, folders })).toThrow(/文件夹数量超限/);
});

it('rejects conflicting immutable metadata for the same asset id', () => {
  const asset = { id: 'asset-1', kind: 'icon' as const, mime: 'image/png' as const, width: 64, height: 64,
    byteLength: 100, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const local = snapshot('device-a', { assets: [asset], shortcuts: [{ ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'asset-1' }) }] });
  const remote = snapshot('device-b', { assets: [{ ...asset, sha256: 'b'.repeat(64) }], shortcuts: local.shortcuts });
  expect(() => mergeSyncSnapshots({ local, remotes: [remote] })).toThrow(/对应不同内容/);
});

it('validates motion metadata and requires motion backgrounds to reference dynamic media', () => {
  const dynamic = { id: 'video-1', kind: 'background' as const, mime: 'video/mp4' as const, width: 1920, height: 1080,
    byteLength: 80 * 1024 * 1024, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null),
    motion: { kind: 'video' as const, duration: 8 } };
  const base = snapshot('device-a');
  const withMotion = { ...base,
    settings: { ...base.settings, appearance: register({ ...createDefaultAppearance(),
      background: { kind: 'motion' as const, assetId: dynamic.id, maskStrength: 0.55 } }) },
    assets: [dynamic] };
  expect(parseSyncSnapshot(withMotion).assets[0]?.motion).toEqual({ kind: 'video', duration: 8 });
  expect(() => parseSyncSnapshot({ ...withMotion, assets: [{ ...dynamic, motion: null }] }))
    .toThrow(/动态媒体缺少动态元数据/);
  expect(() => parseSyncSnapshot({ ...withMotion, settings: { ...withMotion.settings,
    appearance: register({ ...createDefaultAppearance(),
      background: { kind: 'photo' as const, assetId: dynamic.id, maskStrength: 0.55 } }) } }))
    .toThrow(/背景类型与媒体动态属性不匹配/);
  expect(() => parseSyncSnapshot({ ...withMotion, assets: [{ ...dynamic, motion: { ...dynamic.motion, poster: 'not allowed' } }] }))
    .toThrow(/字段不正确/);
});

it('rejects absent media references and accepts large assets without a total cap', () => {
  const missingImage = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'missing' }) };
  expect(() => parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [missingImage] })).toThrow(/图标资源引用不存在/);
  const asset = { id: 'asset-1', kind: 'icon' as const, mime: 'image/png' as const, width: 64, height: 64,
    byteLength: 80 * 1024 * 1024, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const shortcutWithAsset = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'asset-1' }) };
  expect(parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [shortcutWithAsset], assets: [asset] }).assets).toHaveLength(1);
});

it('accepts SVG icon colors only for SVG icon assets in snapshots', () => {
  const asset = { id: 'svg-1', kind: 'icon' as const, mime: 'image/svg+xml' as const, width: 512, height: 512,
    byteLength: 20, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const shortcutWithSvg = { ...shortcut({ title: 'SVG', url: 'https://svg.example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: asset.id, color: '#12abef', occupancy: 75 }) };
  const restoredIcon = parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [shortcutWithSvg], assets: [asset] })
    .shortcuts[0]?.icon.value;
  expect(restoredIcon).toMatchObject({ color: '#12abef' });
  expect(shortcutIconOccupancy(restoredIcon!)).toBe(75);
  const legacyShortcut = { ...shortcut({ title: '旧同步', url: 'https://old-svg.example.test/', deviceId: 'device-a', clock: 2 }),
    icon: register({ kind: 'asset' as const, assetId: asset.id, size: 32 }) };
  expect(parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [legacyShortcut], assets: [asset] })
    .shortcuts[0]?.icon.value).toMatchObject({ occupancy: 67 });
  expect(() => parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [shortcutWithSvg],
    assets: [{ ...asset, mime: 'image/png' }] })).toThrow(/只能用于 SVG/);
  expect(() => parseSyncSnapshot({ ...snapshot('device-a'), assets: [{ ...asset, kind: 'background' }] }))
    .toThrow(/SVG 不能作为背景/);
});

it('reports a typed conflict when a concurrently deleted custom engine remains selected', () => {
  const engine = { id: 'engine-e', name: 'Engine E', template: 'https://search.test/?q={query}', builtIn: false };
  const local = snapshot('device-a', { settings: {
    ...snapshot('device-a').settings, defaultEngineId: register(engine.id, 8, 'device-a'),
    customEngines: [register(engine, 2, 'device-a')],
  } });
  const remote = snapshot('device-b', { tombstones: [{ entityType: 'custom-engine', id: engine.id, clock: 9, deviceId: 'device-b' }] });

  expectMergeConflict(() => mergeSyncSnapshots({ local, remotes: [remote] }), 'custom-engine-deleted-while-default', engine.id);
});

it('reports a typed conflict when a concurrently deleted asset remains referenced', () => {
  const asset = { id: 'asset-e', kind: 'icon' as const, mime: 'image/png' as const, width: 64, height: 64,
    byteLength: 100, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const shortcutWithAsset = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: asset.id }) };
  const local = snapshot('device-a', { shortcuts: [shortcutWithAsset], assets: [asset] });
  const remote = snapshot('device-b', { tombstones: [{ entityType: 'asset', id: asset.id, clock: 2, deviceId: 'device-b' }] });

  expectMergeConflict(() => mergeSyncSnapshots({ local, remotes: [remote] }), 'asset-deleted-while-referenced', asset.id);
});

it('requires a permanent folder tombstone for a dangling placement', () => {
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 8, folderId: 'deleted-folder' });
  const input = snapshot('device-a', { shortcuts: [child] });
  expect(() => parseSyncSnapshot(input)).toThrow(/文件夹引用不存在/);
  const deleted = { ...input, tombstones: [{ entityType: 'folder' as const, id: 'deleted-folder', clock: 1, deviceId: 'device-b' }] };
  expect(parseSyncSnapshot(deleted).shortcuts[0]?.placement).toEqual(child.placement);
  expect(materializeSyncSnapshot(deleted).shortcuts[0]?.folderId).toBeNull();
});

it('converges after remerging a deleted-folder projection with an offline live replica', () => {
  const folder = { id: 'gone', name: register('工作'), position: register(0) };
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 8, folderId: folder.id });
  const offline = snapshot('device-a', { folders: [folder], shortcuts: [child] });
  const deleted = snapshot('device-b', { tombstones: [{ entityType: 'folder', id: folder.id, clock: 2, deviceId: 'device-b' }] });
  const first = mergeSyncSnapshots({ local: offline, remotes: [deleted] });
  const repeated = mergeSyncSnapshots({ local: first, remotes: [offline, deleted] });
  expect(repeated).toEqual(first);
  expect(repeated.shortcuts[0]?.placement).toEqual(child.placement);
  expect(repeated.folders).toEqual([]);
  expect(materializeSyncSnapshot(repeated).shortcuts[0]?.folderId).toBeNull();
});
