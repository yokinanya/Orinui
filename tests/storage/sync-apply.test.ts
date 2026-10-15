import { afterEach, expect, it, vi } from 'vitest';
import type { MediaAsset } from '@/domain/asset';
import { mergeSyncSnapshots, type SyncSnapshotV1 } from '@/domain/sync';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { validateStoredMediaAsset } from '@/platform/sync-images';
import { createDatabase, type Database } from '@/storage/db';
import { createShortcut, deleteShortcut } from '@/storage/shortcuts';
import { applySyncSnapshot } from '@/storage/sync/apply';
import { exportSyncSnapshot } from '@/storage/sync/export';
import { initializeSyncVault } from '@/storage/sync/vault';
import type { SyncRecordRow } from '@/storage/sync/types';

const TEST_VAULT_ID = 'vault-apply-test';
const TEST_DEVICE_ID = 'device-local';
const TEST_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  vi.unstubAllGlobals();
});

async function freshDatabase(now: () => number): Promise<Database> {
  const database = createDatabase(`sync-apply-${crypto.randomUUID()}`, { now });
  databases.push(database);
  const { key } = await createSyncCrypto(globalThis.crypto).createKey();
  await initializeSyncVault(database, { vaultId: TEST_VAULT_ID, deviceId: TEST_DEVICE_ID, key });
  return database;
}

async function exported(database: Database) {
  return exportSyncSnapshot(database, createSyncCrypto(globalThis.crypto));
}

async function addImageShortcut(database: Database, title: string) {
  const state = await database.sync_state.get('app');
  if (!state) throw new Error('缺少同步状态');
  const group = await database.groups.get(state.defaultGroupId.value);
  if (!group) throw new Error('缺少默认分组');
  return createShortcut(database, { groupId: group.id, title, url: 'https://image.test', image: {
    kind: 'icon', mime: 'image/png', width: 1, height: 1, blob: new Blob([TEST_PNG], { type: 'image/png' }),
  } });
}

function dependencies(hash?: (bytes: Uint8Array) => Promise<string>) {
  return { crypto: { hash: hash ?? createSyncCrypto(globalThis.crypto).hash },
    validateStoredMediaAsset: vi.fn(async (asset: MediaAsset) => asset) };
}

function remoteSnapshot(local: SyncSnapshotV1, changes: Partial<SyncSnapshotV1>): SyncSnapshotV1 {
  return { ...local, deviceId: 'device-remote', generation: 1, ...changes };
}

it('atomically applies a merged snapshot and retains the non-exported crypto key', async () => {
  const database = await freshDatabase(() => 1_000);
  const before = await exported(database);
  const group = before.snapshot.groups[0];
  if (!group) throw new Error('缺少初始分组');
  const remote = remoteSnapshot(before.snapshot, { groups: [{ ...group,
    name: { value: '跨设备名称', clock: group.name.clock + 1, deviceId: 'device-remote' } }] });
  const merged = mergeSyncSnapshots({ local: before.snapshot, remotes: [remote] });

  await applySyncSnapshot(database, { snapshot: merged, assets: [], expectedGeneration: before.localGeneration }, dependencies());

  expect((await database.groups.get(group.id))?.name).toBe('跨设备名称');
  expect((await database.sync_state.get('app'))?.generation).toBe(merged.generation);
  expect(await database.sync_keys.count()).toBe(1);
});

it('rejects a stale local generation before replacing any domain data', async () => {
  const database = await freshDatabase(() => 1_000);
  const before = await exported(database);
  const groupBefore = await database.groups.toArray();

  await expect(applySyncSnapshot(database, { snapshot: before.snapshot, assets: [],
    expectedGeneration: before.localGeneration + 1 }, dependencies())).rejects.toThrow(/本机数据在同步期间已变化/);

  expect(await database.groups.toArray()).toEqual(groupBefore);
  expect((await database.sync_state.get('app'))?.suspended).toBe(false);
});

it('rolls back suspension and data replacement if a local grave is missing from the merge', async () => {
  const database = await freshDatabase(() => 1_000);
  const before = await exported(database);
  const tombstone = { entityType: 'shortcut' as const, id: 'shortcut-deleted', clock: 2, deviceId: TEST_DEVICE_ID };
  const grave: SyncRecordRow = { id: `shortcut:${tombstone.id}`, kind: 'tombstone', entityId: tombstone.id, tombstone };
  await database.sync_records.bulkPut([grave]);
  const groupsBefore = await database.groups.toArray();

  await expect(applySyncSnapshot(database, { snapshot: { ...before.snapshot, tombstones: [] }, assets: [],
    expectedGeneration: before.localGeneration }, dependencies())).rejects.toThrow(/缺少本地删除墓碑/);

  expect(await database.groups.toArray()).toEqual(groupsBefore);
  expect((await database.sync_state.get('app'))?.suspended).toBe(false);
  expect((await database.sync_records.get(`shortcut:${tombstone.id}`))?.kind).toBe('tombstone');
});

it('keeps an unexpired undo deletion hidden while preserving its pending metadata', async () => {
  let now = 10_000;
  const database = await freshDatabase(() => now);
  const state = await database.sync_state.get('app');
  if (!state) throw new Error('缺少同步状态');
  const group = await database.groups.get(state.defaultGroupId.value);
  if (!group) throw new Error('缺少默认分组');
  const shortcut = await createShortcut(database, { groupId: group.id, title: '稍后撤销', url: 'https://undo.test' });
  expect((await database.sync_records.get(`shortcut:${shortcut.id}`))?.kind).toBe('shortcut');
  await deleteShortcut(database, shortcut.id);
  expect((await database.sync_records.get(`shortcut:${shortcut.id}`))?.kind).toBe('shortcut');
  const before = await exported(database);
  now += 1_000;

  await applySyncSnapshot(database, { snapshot: before.snapshot, assets: [], expectedGeneration: before.localGeneration }, dependencies());

  expect(await database.shortcuts.get(shortcut.id)).toBeUndefined();
  const pending = await database.sync_records.get(`shortcut:${shortcut.id}`) as SyncRecordRow | undefined;
  expect(pending?.kind).toBe('shortcut');
  if (pending?.kind !== 'shortcut') throw new Error('撤销记录未保留');
  expect(pending.pendingDeleteUntil).toBe(15_000);
});

it('lets a remote grave cancel a pending undo and prevents local resurrection', async () => {
  const database = await freshDatabase(() => 10_000);
  const state = await database.sync_state.get('app');
  if (!state) throw new Error('缺少同步状态');
  const group = await database.groups.get(state.defaultGroupId.value);
  if (!group) throw new Error('缺少默认分组');
  const shortcut = await createShortcut(database, { groupId: group.id, title: '远端删除', url: 'https://grave.test' });
  await deleteShortcut(database, shortcut.id);
  const before = await exported(database);
  const grave = { entityType: 'shortcut' as const, id: shortcut.id, clock: before.snapshot.shortcuts[0]!.title.clock + 10, deviceId: 'device-remote' };
  const merged = mergeSyncSnapshots({ local: before.snapshot, remotes: [remoteSnapshot(before.snapshot, {
    shortcuts: [], tombstones: [grave],
  })] });

  await applySyncSnapshot(database, { snapshot: merged, assets: [], expectedGeneration: before.localGeneration }, dependencies());

  expect(await database.shortcuts.get(shortcut.id)).toBeUndefined();
  expect((await database.sync_records.get(`shortcut:${shortcut.id}`))?.kind).toBe('tombstone');
});

it('validates media hashes before the transaction and applies verified bytes', async () => {
  const database = await freshDatabase(() => 10_000);
  await addImageShortcut(database, '图片校验');
  const before = await exported(database);
  const verifier = vi.fn(async (asset: MediaAsset) => asset);
  const wrongHash = dependencies(async () => '0'.repeat(64));

  await expect(applySyncSnapshot(database, { snapshot: before.snapshot, assets: before.assets,
    expectedGeneration: before.localGeneration }, wrongHash)).rejects.toThrow(/SHA-256 校验失败/);
  expect(wrongHash.validateStoredMediaAsset).not.toHaveBeenCalled();
  expect((await database.sync_state.get('app'))?.generation).toBe(before.localGeneration);

  await applySyncSnapshot(database, { snapshot: before.snapshot, assets: before.assets,
    expectedGeneration: before.localGeneration }, { crypto: createSyncCrypto(globalThis.crypto), validateStoredMediaAsset: verifier });

  expect(verifier).toHaveBeenCalledTimes(1);
  expect(await database.assets.count()).toBe(1);
});

it('keeps the only image referenced by a pending undo in sync-record cache', async () => {
  const database = await freshDatabase(() => 10_000);
  const shortcut = await addImageShortcut(database, '撤销图片');
  await deleteShortcut(database, shortcut.id);
  const before = await exported(database);

  await applySyncSnapshot(database, { snapshot: before.snapshot, assets: before.assets,
    expectedGeneration: before.localGeneration }, dependencies());

  expect(await database.assets.count()).toBe(0);
  const assetId = before.assets[0]?.id;
  if (!assetId) throw new Error('导出快照缺少图片资源');
  const assetRecord = await database.sync_records.get(`asset:${assetId}`);
  expect(assetRecord?.kind).toBe('asset');
  if (assetRecord?.kind !== 'asset') throw new Error('同步图片缓存记录未保留');
  expect(assetRecord.retainedAsset?.blob.size).toBe(TEST_PNG.byteLength);
});

it('checks real image bytes and decoded dimensions at the production verifier boundary', async () => {
  const close = vi.fn();
  const decode = vi.fn(async () => ({ width: 1, height: 1, close }));
  vi.stubGlobal('createImageBitmap', decode);
  const asset: MediaAsset = { id: 'image-1', kind: 'icon', mime: 'image/png', width: 1, height: 1,
    blob: new Blob([TEST_PNG], { type: 'image/png' }), sourceUrl: null };

  await validateStoredMediaAsset(asset);

  expect(decode).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  await expect(validateStoredMediaAsset({ ...asset,
    blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/png' }) })).rejects.toThrow(/文件签名/);
});
