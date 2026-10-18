import { expect, it } from 'vitest';
import { createSyncCoordinator, SyncCoordinatorError } from '@/sync';
import { crypto, createTestDevice, SharedFifoLock } from './fixtures/devices';
import { SyncObjectServer } from './server';

it('repairs a missing published media object from verified local bytes and reports the repair', async () => {
  const server = new SyncObjectServer();
  const device = await createTestDevice({ deviceId: 'repair-device', lock: new SharedFifoLock(), server, seedImage: true });
  try {
    const coordinator = createSyncCoordinator(device.dependencies);
    await coordinator.syncNow();
    const asset = (await device.db.assets.toArray())[0]!;
    server.deleteAsset(asset.id);
    const result = await coordinator.syncNow();
    expect(result).toMatchObject({ state: 'synced', uploadedAssets: 1, repairedAssetIds: [asset.id] });
    expect(server.assetBytes(asset.id)).toBeDefined();
  } finally { await device.db.delete(); }
});

it('skips same-size media reads on a known-good device and rejects tampering on a receiver', async () => {
  const server = new SyncObjectServer();
  const recoveryKey = await crypto.createKey();
  const device = await createTestDevice({ deviceId: 'integrity-device', lock: new SharedFifoLock(), server,
    recoveryKey: recoveryKey.recoveryKey, seedImage: true });
  const receiver = await createTestDevice({ deviceId: 'integrity-receiver', lock: new SharedFifoLock(), server,
    recoveryKey: recoveryKey.recoveryKey });
  try {
    const coordinator = createSyncCoordinator(device.dependencies);
    await coordinator.syncNow();
    const asset = (await device.db.assets.toArray())[0]!;
    const damaged = server.assetBytes(asset.id)!;
    damaged[damaged.length - 1] = damaged[damaged.length - 1]! ^ 1;
    server.putAsset(asset.id, damaged);
    const priorSuccess = (await device.db.sync_state.get('app'))?.lastSuccessfulSync;
    const previousCreates = server.events.filter((event) => event.kind === 'create-asset').length;
    const failure = await createSyncCoordinator(receiver.dependencies).syncNow().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncCoordinatorError);
    expect(failure).toMatchObject({ phase: 'receiving-media', publication: 'not-started' });
    expect(server.assetBytes(asset.id)).toEqual(damaged);
    expect(server.events.filter((event) => event.kind === 'create-asset')).toHaveLength(previousCreates);
    expect((await device.db.sync_state.get('app'))?.lastSuccessfulSync).toEqual(priorSuccess);
    const readEvents = server.events.filter((event) => event.kind === 'read-asset').length;
    await coordinator.syncNow();
    expect(server.events.filter((event) => event.kind === 'read-asset')).toHaveLength(readEvents);
  } finally { await Promise.all([device.db.delete(), receiver.db.delete()]); }
});

it('does not overwrite media that appears concurrently with the same ID but different contents', async () => {
  const wrongKey = (await crypto.createKey()).key;
  const wrongBytes = await crypto.encrypt({ key: wrongKey, context: { vaultId: 'sync-test-vault', kind: 'asset', objectId: 'unused' },
    plaintext: new Uint8Array([1]) });
  const server = new SyncObjectServer({ beforeCreateAsset: async (assetId) => { server.putAsset(assetId, wrongBytes); } });
  const device = await createTestDevice({ deviceId: 'race-device', lock: new SharedFifoLock(), server, seedImage: true });
  try {
    const failure = await createSyncCoordinator(device.dependencies).syncNow().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncCoordinatorError);
    expect(failure).toMatchObject({ phase: 'uploading-media', publication: 'not-started' });
    expect(server.events.some((event) => event.kind === 'publish')).toBe(false);
    const asset = (await device.db.assets.toArray())[0]!;
    expect(server.assetBytes(asset.id)).toEqual(wrongBytes);
  } finally { await device.db.delete(); }
});
