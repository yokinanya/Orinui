import { afterEach, beforeEach, expect, it } from 'vitest';
import { updateShortcut } from '@/storage/shortcuts';
import { disconnectSyncVault, initializeSyncVault, readSyncKey } from '@/storage/sync/vault';
import { createSyncCoordinator, SyncCoordinatorError } from '@/sync';
import { crypto, createTestDevice, deferred, deleteDevices, SharedFifoLock, vaultId, type TestDevice } from './fixtures/devices';
import { SyncObjectServer, type SyncObjectServerHooks } from './server';

let devices: TestDevice[];
let recoveryKey: string;
let lock: SharedFifoLock;

beforeEach(async () => {
  devices = [];
  recoveryKey = (await crypto.createKey()).recoveryKey;
  lock = new SharedFifoLock();
});

afterEach(async () => deleteDevices(devices));

async function addDevice(input: {
  readonly deviceId: string;
  readonly seedImage?: boolean;
  readonly runIds?: string[];
  readonly server: SyncObjectServer;
}): Promise<TestDevice> {
  const device = await createTestDevice({ ...input, recoveryKey, lock });
  devices.push(device);
  return device;
}

it('rejects a stale apply if a user edit lands after export and preserves that edit', async () => {
    let device: TestDevice | undefined;
    let edited = false;
    const server = new SyncObjectServer({ afterListSnapshots: async () => {
      if (edited || !device) return;
      edited = true;
      const shortcut = (await device.db.shortcuts.toArray())[0];
      if (shortcut) await updateShortcut(device.db, shortcut.id, { title: 'User edit wins locally' });
    } });
    device = await addDevice({ deviceId: 'device-a', seedImage: true, server });
    const failure = await createSyncCoordinator(device.dependencies).syncNow().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncCoordinatorError);
    expect(failure).toMatchObject({ phase: 'applying', publication: 'not-started', statusRecorded: true });
    expect((await device.db.shortcuts.toArray())[0]).toMatchObject({ title: 'User edit wins locally' });
    expect(server.events.some((event) => event.kind === 'publish')).toBe(false);
});

it('publishes the applied candidate during upload but reports later edits as pending', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let blocked = false;
    const server = new SyncObjectServer({ beforeCreateAsset: async () => {
      if (blocked) return;
      blocked = true;
      entered.resolve();
      await release.promise;
    } });
    const device = await addDevice({ deviceId: 'device-a', seedImage: true, server });
    const shortcutId = (await device.db.shortcuts.toArray())[0]?.id;
    expect(shortcutId).toBeDefined();
    const running = createSyncCoordinator(device.dependencies).syncNow();
    await entered.promise;
    await updateShortcut(device.db, shortcutId!, { title: 'Edited during upload' });
    release.resolve();
    await expect(running).resolves.toMatchObject({ state: 'pending' });
    await expect(createSyncCoordinator(device.dependencies).syncNow()).resolves.toMatchObject({ state: 'synced' });
    expect((await device.db.shortcuts.get(shortcutId!))?.title).toBe('Edited during upload');
});

it('serializes two coordinators for one database and runs again after the first fails', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let calls = 0;
    const server = new SyncObjectServer({ afterListSnapshots: async () => {
      calls += 1;
      if (calls !== 1) return;
      entered.resolve();
      await release.promise;
      throw new Error('First read failed');
    } });
    const device = await addDevice({ deviceId: 'device-a', runIds: ['run-one', 'run-two'], server });
    const coordinator = createSyncCoordinator(device.dependencies);
    const first = coordinator.syncNow();
    const second = createSyncCoordinator(device.dependencies).syncNow();
    await entered.promise;
    expect(calls).toBe(1);
    release.resolve();
    const results = await Promise.allSettled([first, second]);
    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('fulfilled');
    expect(calls).toBe(2);
    expect((await device.db.sync_state.get('app'))?.lastSync).toMatchObject({ runId: 'run-two', status: 'succeeded' });
});

it('prevents a disconnected run from recording against the same reconnected vault and device', async () => {
    const entered = deferred<void>();
    const release = deferred<void>();
    let blocked = false;
    const server = new SyncObjectServer({ beforeCreateAsset: async () => {
      if (blocked) return;
      blocked = true;
      entered.resolve();
      await release.promise;
    } });
    const device = await addDevice({ deviceId: 'device-old', seedImage: true, server });
    const pending = createSyncCoordinator(device.dependencies).syncNow();
    await entered.promise;
    const key = await readSyncKey(device.db, vaultId);
    await disconnectSyncVault(device.db);
    await initializeSyncVault(device.db, { vaultId, deviceId: 'device-old', key });
    release.resolve();
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncCoordinatorError);
    expect((await device.db.sync_state.get('app'))).toMatchObject({ vaultId, deviceId: 'device-old' });
    expect((await device.db.sync_state.get('app'))?.lastSync).toBeUndefined();
    expect(server.events.some((event) => event.kind === 'publish')).toBe(false);
});
