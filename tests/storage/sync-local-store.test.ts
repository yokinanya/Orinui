import { afterEach, expect, it } from 'vitest';
import type { MediaAsset } from '@/domain/asset';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { createDatabase, type Database } from '@/storage/db';
import { createShortcut } from '@/storage/shortcuts';
import { disconnectSyncVault, initializeSyncVault } from '@/storage/sync/vault';
import { createSyncLocalStore } from '@/storage/sync/local-store';
import type { SyncRunIdentity } from '@/sync/ports';

const cryptoRuntime = createSyncCrypto(globalThis.crypto);
const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

async function setup() {
  const database = createDatabase(`sync-local-${crypto.randomUUID()}`);
  databases.push(database);
  const { key } = await cryptoRuntime.createKey();
  await initializeSyncVault(database, { vaultId: 'vault-local-store', deviceId: 'device-local-store', key });
  const local = createSyncLocalStore(database, {
    crypto: cryptoRuntime,
    validateStoredMediaAsset: async (asset: MediaAsset) => asset,
  });
  return { database, local };
}

async function begin(local: ReturnType<typeof createSyncLocalStore>, runId: string): Promise<SyncRunIdentity> {
  const session = await local.begin({ runId, startedAt: 10 });
  return { runId, vaultId: session.vaultId, deviceId: session.deviceId };
}

it('begins with an atomic key, connection identity, and prior-success flag', async () => {
  const { database, local } = await setup();
  const session = await local.begin({ runId: 'run-one', startedAt: 10 });

  expect(session).toMatchObject({ vaultId: 'vault-local-store', deviceId: 'device-local-store', hasBaseline: false });
  expect(session.key.extractable).toBe(false);
  expect(await database.sync_state.get('app')).toMatchObject({ lastSync: {
    runId: 'run-one', status: 'running', phase: 'reading', publication: 'not-started', startedAt: 10,
  } });
});

it('exports a current snapshot and rejects run identities after a new run takes ownership', async () => {
  const { local } = await setup();
  const first = await begin(local, 'run-old');
  const exported = await local.export(first);
  expect(exported.snapshot.deviceId).toBe(first.deviceId);
  await begin(local, 'run-new');

  await expect(local.assertCurrent(first)).rejects.toThrow(/新的运行取代/);
});

it('checks the expected generation without changing sync metadata', async () => {
  const { database, local } = await setup();
  const identity = await begin(local, 'run-generation');
  const exported = await local.export(identity);
  await createShortcut(database, { folderId: null, title: '本机改动', url: 'https://local.test' });

  await expect(local.assertCurrent({ ...identity, expectedGeneration: exported.localGeneration }))
    .rejects.toThrow(/本机数据在同步期间已变化/);
  expect((await database.sync_state.get('app'))?.lastSync?.status).toBe('running');
});

it('records apply metadata in the same operation and marks later edits pending on finish', async () => {
  const { database, local } = await setup();
  const identity = await begin(local, 'run-apply');
  const exported = await local.export(identity);
  await local.apply({ ...identity, snapshot: exported.snapshot, assets: [],
    expectedGeneration: exported.localGeneration, appliedAt: 20 });
  expect((await database.sync_state.get('app'))?.lastSync).toMatchObject({
    runId: identity.runId, appliedGeneration: exported.localGeneration, appliedAt: 20, phase: 'uploading-media',
  });
  await local.markPhase({ ...identity, phase: 'publishing', publication: 'unconfirmed' });
  await createShortcut(database, { folderId: null, title: '发布期间编辑', url: 'https://pending.test' });

  const result = await local.finish({ ...identity, publishedGeneration: exported.localGeneration,
    revision: 'rev-1', completedAt: 30 });

  expect(result).toEqual({ localGeneration: exported.localGeneration + 1, pendingEdits: true });
  expect(await database.sync_state.get('app')).toMatchObject({ lastSuccessfulSync: {
    at: 30, generation: exported.localGeneration, revision: 'rev-1',
  }, lastSync: { status: 'succeeded', pendingEdits: true, publication: 'confirmed' } });
});

it('requires the same applied generation before accepting a publication receipt', async () => {
  const { local } = await setup();
  const identity = await begin(local, 'run-no-apply');

  await expect(local.finish({ ...identity, publishedGeneration: 0, revision: 'rev', completedAt: 30 }))
    .rejects.toThrow(/已应用代次不一致/);
});

it('keeps the accepted baseline after publication and a later read failure', async () => {
  const { database, local } = await setup();
  const first = await begin(local, 'run-join');
  const exported = await local.export(first);
  await local.apply({ ...first, snapshot: exported.snapshot, assets: [],
    expectedGeneration: exported.localGeneration, appliedAt: 20 });
  await local.fail({ ...first, phase: 'publishing', publication: 'unconfirmed',
    error: { name: 'Error', message: '首次发布失败' }, failedAt: 30 });

  const second = await local.begin({ runId: 'run-read-failure', startedAt: 40 });
  expect(second.hasBaseline).toBe(true);
  await local.fail({ runId: 'run-read-failure', vaultId: second.vaultId, deviceId: second.deviceId,
    phase: 'reading', publication: 'not-started', error: { name: 'Error', message: '远端读取失败' }, failedAt: 50 });

  const third = await local.begin({ runId: 'run-retry', startedAt: 60 });
  expect(third.hasBaseline).toBe(true);
  expect((await database.sync_state.get('app'))?.lastSuccessfulSync).toBeUndefined();
});

it('persists normal failures but leaves a replacement connection untouched', async () => {
  const { database, local } = await setup();
  const oldIdentity = await begin(local, 'run-before-disconnect');
  await disconnectSyncVault(database);
  const { key } = await cryptoRuntime.createKey();
  await initializeSyncVault(database, { vaultId: oldIdentity.vaultId, deviceId: oldIdentity.deviceId, key });
  const replacement = await begin(local, 'run-after-reconnect');
  const staleResult = await local.fail({ ...oldIdentity, phase: 'publishing', publication: 'unconfirmed',
    error: { name: 'Error', message: '旧运行错误' }, failedAt: 40 });

  expect(staleResult).toBe(false);
  const accepted = await local.fail({ ...replacement, phase: 'receiving-media', publication: 'not-started',
    error: { name: 'Error', message: '读取媒体失败' }, failedAt: 50 });
  expect(accepted).toBe(true);
  expect((await database.sync_state.get('app'))?.lastSync).toMatchObject({ status: 'failed',
    error: { name: 'Error', message: '读取媒体失败' }, finishedAt: 50 });
});
