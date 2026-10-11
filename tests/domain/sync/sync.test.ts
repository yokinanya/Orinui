import { expect, it } from 'vitest';
import { createDefaultAppearance } from '@/domain/appearance';
import { DEFAULT_LAYOUT } from '@/domain/layout';
import { mergeSyncSnapshots, materializeSyncSnapshot, parseSyncSnapshot, SyncMergeConflictError } from '@/domain/sync';
import type { SyncRegister, SyncSnapshotV1 } from '@/domain/sync';

const IMAGE_TOTAL_LIMIT_BYTES = 50 * 1024 * 1024;

function register<T>(value: T, clock = 1, deviceId = 'device-a'): SyncRegister<T> {
  return { value, clock, deviceId };
}

function snapshot(deviceId: string, changes: Partial<SyncSnapshotV1> = {}): SyncSnapshotV1 {
  return {
    schemaVersion: 1, vaultId: 'vault-1', deviceId, generation: 1,
    defaultGroupId: register('group-default'),
    groups: [{ id: 'group-default', name: register('常用'), colorRole: register('primary' as const), position: register(0) }],
    shortcuts: [],
    settings: {
      appearance: register(createDefaultAppearance()), defaultEngineId: register('google'),
      layout: register(DEFAULT_LAYOUT), clock: register({ format: 'system' as const }), customEngines: [],
    },
    assets: [], tombstones: [], ...changes,
  };
}

function shortcut(input: { readonly title: string; readonly url: string; readonly deviceId: string; readonly clock: number }) {
  const { title, url, deviceId, clock } = input;
  return { id: 'shortcut-1', title: register(title, clock, deviceId), url: register(url, clock, deviceId),
    placement: register({ groupId: 'group-default', order: 0 }, clock, deviceId),
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

it('prefers an entity tombstone to a live replica and rejects the same tombstone beside a live entity', () => {
  const live = snapshot('device-a', { shortcuts: [shortcut({ title: 'Title', url: 'https://example.test/', deviceId: 'device-a', clock: 2 })] });
  const deleted = snapshot('device-b', { tombstones: [{ entityType: 'shortcut', id: 'shortcut-1', clock: 1, deviceId: 'device-b' }] });
  expect(mergeSyncSnapshots({ local: live, remotes: [deleted] }).shortcuts).toEqual([]);
  expect(() => parseSyncSnapshot({ ...live, tombstones: deleted.tombstones })).toThrow(/同时处于存活和删除状态/);
});

it('cascades a live shortcut still pointing to a deleted group', () => {
  const extraGroup = { id: 'group-extra', name: register('额外'), colorRole: register(null), position: register(1) };
  const child = { ...shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 2 }),
    placement: register({ groupId: 'group-extra', order: 0 }, 2, 'device-a') };
  const local = snapshot('device-a', { groups: [...snapshot('device-a').groups, extraGroup], shortcuts: [child] });
  const deletedGroup = snapshot('device-b', { tombstones: [{ entityType: 'group', id: 'group-extra', clock: 3, deviceId: 'device-b' }] });
  const result = mergeSyncSnapshots({ local, remotes: [deletedGroup] });
  expect(result.shortcuts).toEqual([]);
  expect(result.tombstones).toContainEqual({ entityType: 'shortcut', id: 'shortcut-1', clock: 3, deviceId: 'device-b' });
});

it('preserves a child moved out of a deleted group when the placement register wins', () => {
  const extraGroup = { id: 'group-extra', name: register('额外'), colorRole: register(null), position: register(1) };
  const child = { ...shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 2 }),
    placement: register({ groupId: 'group-extra', order: 0 }, 2, 'device-a') };
  const local = snapshot('device-a', { groups: [...snapshot('device-a').groups, extraGroup], shortcuts: [child] });
  const deletedGroup = snapshot('device-b', { tombstones: [{ entityType: 'group', id: 'group-extra', clock: 3, deviceId: 'device-b' }] });
  const moved = snapshot('device-c', { shortcuts: [{ ...child,
    placement: register({ groupId: 'group-default', order: 0 }, 4, 'device-c') }] });
  const result = mergeSyncSnapshots({ local, remotes: [deletedGroup, moved] });
  expect(result.shortcuts[0]?.placement.value.groupId).toBe('group-default');
  expect(result.tombstones.some(({ entityType, id }) => entityType === 'shortcut' && id === 'shortcut-1')).toBe(false);
});

it('derives contiguous deterministic positions without changing register clocks', () => {
  const groups = [
    { id: 'g2', name: register('二'), colorRole: register(null), position: register(0, 2, 'device-b') },
    { id: 'group-default', name: register('常用'), colorRole: register('primary' as const), position: register(0) },
  ];
  const merged = mergeSyncSnapshots({ local: snapshot('device-a', { groups }), remotes: [] });
  expect(materializeSyncSnapshot(merged).groups.map(({ id, order }) => [id, order])).toEqual([['g2', 0], ['group-default', 1]]);
  expect(merged.groups.find(({ id }) => id === 'g2')?.position.clock).toBe(2);
});

it('rejects unknown versions, unknown fields, excess entities and broken references', () => {
  const valid = snapshot('device-a');
  expect(() => parseSyncSnapshot({ ...valid, schemaVersion: 2 })).toThrow(/版本不受支持/);
  expect(() => parseSyncSnapshot({ ...valid, extra: true })).toThrow(/字段不正确/);
  expect(() => parseSyncSnapshot({ ...valid, defaultGroupId: register('missing') })).toThrow(/默认分组引用不存在/);
  const groups = Array.from({ length: 51 }, (_, index) => ({ id: `group-${index}`, name: register(`分组${index}`),
    colorRole: register(null), position: register(index) }));
  expect(() => parseSyncSnapshot({ ...valid, groups, defaultGroupId: register('group-0') })).toThrow(/分组数量超限/);
  const brokenReference = { ...shortcut({ title: 'Title', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    placement: register({ groupId: 'missing', order: 0 }) };
  expect(() => parseSyncSnapshot({ ...valid, shortcuts: [brokenReference] }))
    .toThrow(/所属分组引用不存在/);
});

it('rejects conflicting immutable metadata for the same asset id', () => {
  const asset = { id: 'asset-1', kind: 'icon' as const, mime: 'image/png' as const, width: 64, height: 64,
    byteLength: 100, sha256: 'a'.repeat(64), sourceUrl: register(null) };
  const local = snapshot('device-a', { assets: [asset], shortcuts: [{ ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'asset-1' }) }] });
  const remote = snapshot('device-b', { assets: [{ ...asset, sha256: 'b'.repeat(64) }], shortcuts: local.shortcuts });
  expect(() => mergeSyncSnapshots({ local, remotes: [remote] })).toThrow(/对应不同内容/);
});

it('rejects absent media references and media totals above the data contract limit', () => {
  const missingImage = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'missing' }) };
  expect(() => parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [missingImage] })).toThrow(/图标资源引用不存在/);
  const asset = { id: 'asset-1', kind: 'icon' as const, mime: 'image/png' as const, width: 64, height: 64,
    byteLength: IMAGE_TOTAL_LIMIT_BYTES + 1, sha256: 'a'.repeat(64), sourceUrl: register(null) };
  const shortcutWithAsset = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'asset-1' }) };
  expect(() => parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [shortcutWithAsset], assets: [asset] }))
    .toThrow(/图片资源总量超过/);
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
    byteLength: 100, sha256: 'a'.repeat(64), sourceUrl: register(null) };
  const shortcutWithAsset = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: asset.id }) };
  const local = snapshot('device-a', { shortcuts: [shortcutWithAsset], assets: [asset] });
  const remote = snapshot('device-b', { tombstones: [{ entityType: 'asset', id: asset.id, clock: 2, deviceId: 'device-b' }] });

  expectMergeConflict(() => mergeSyncSnapshots({ local, remotes: [remote] }), 'asset-deleted-while-referenced', asset.id);
});

it('reports a typed conflict when the selected default group is concurrently deleted', () => {
  const extra = { id: 'group-extra', name: register('额外'), colorRole: register('primary' as const), position: register(1) };
  const local = snapshot('device-a', { groups: [...snapshot('device-a').groups, extra],
    defaultGroupId: register(extra.id, 8, 'device-a') });
  const remote = snapshot('device-b', { tombstones: [{ entityType: 'group', id: extra.id, clock: 9, deviceId: 'device-b' }] });

  expectMergeConflict(() => mergeSyncSnapshots({ local, remotes: [remote] }), 'default-group-deleted', extra.id);
});
