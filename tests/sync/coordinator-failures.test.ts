import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { decodeSyncSnapshot, encodeSyncSnapshot } from '@/platform/sync-codec';
import { updateShortcut } from '@/storage/shortcuts';
import { createSyncCoordinator, SyncCoordinatorError } from '@/sync';
import { readSyncKey } from '@/storage/sync/vault';
import { addFixtureImageShortcut, crypto, createTestDevice, deleteDevices, SharedFifoLock, vaultId, type TestDevice } from './fixtures/devices';
import { SyncObjectServer, type SyncObjectServerHooks } from './server';

let devices: TestDevice[];
let server: SyncObjectServer;
let lock: SharedFifoLock;
let recoveryKey: string;

beforeEach(async () => {
  devices = [];
  server = new SyncObjectServer();
  lock = new SharedFifoLock();
  recoveryKey = (await crypto.createKey()).recoveryKey;
});

afterEach(async () => deleteDevices(devices));

async function addDevice(input: {
  readonly deviceId: string;
  readonly seedImage?: boolean;
  readonly seedWebsite?: boolean;
  readonly runIds?: string[];
  readonly hooks?: SyncObjectServerHooks;
}): Promise<TestDevice> {
  if (input.hooks) server = new SyncObjectServer(input.hooks);
  const device = await createTestDevice({ ...input, recoveryKey, lock, server });
  devices.push(device);
  return device;
}

async function sync(device: TestDevice) {
  return createSyncCoordinator(device.dependencies).syncNow();
}

function expectCoordinatorError(error: unknown, expected: {
  readonly phase: string;
  readonly publication: string;
  readonly statusRecorded: boolean;
}): void {
  expect(error).toBeInstanceOf(SyncCoordinatorError);
  expect(error).toMatchObject(expected);
}

it('rejects a corrupt remote ciphertext before applying remote data', async () => {
    const device = await addDevice({ deviceId: 'device-local' });
    server.putSnapshot('device-corrupt', new Uint8Array([1, 2, 3]));
    const failure = await sync(device).catch((error: unknown) => error);
    expectCoordinatorError(failure, { phase: 'reading', publication: 'not-started', statusRecorded: true });
    expect(await device.db.shortcuts.count()).toBe(0);
    expect((await device.db.sync_state.get('app'))?.lastSuccessfulSync).toBeUndefined();
});

it('rejects missing remote media before applying the referencing snapshot', async () => {
    const first = await addDevice({ deviceId: 'device-a', seedImage: true });
    await sync(first);
    const assetId = (await first.db.assets.toArray())[0]?.id;
    expect(assetId).toBeDefined();
    server.deleteAsset(assetId!);
    const second = await addDevice({ deviceId: 'device-b' });
    const before = (await second.db.sync_state.get('app'))?.generation;
    const failure = await sync(second).catch((error: unknown) => error);
    expectCoordinatorError(failure, { phase: 'receiving-media', publication: 'not-started', statusRecorded: true });
    expect(await second.db.shortcuts.count()).toBe(0);
    expect((await second.db.sync_state.get('app'))?.generation).toBe(before);
});

it('rejects immutable metadata collisions for a shared media ID during merge', async () => {
    const first = await addDevice({ deviceId: 'device-a', seedImage: true });
    await sync(first);
    const bytes = server.snapshotBytes('device-a');
    expect(bytes).toBeDefined();
    const context = { vaultId, kind: 'snapshot' as const, objectId: 'device-a' };
    const key = await readSyncKey(first.db, vaultId);
    const plaintext = await crypto.decrypt({ key, context, ciphertext: bytes! });
    const snapshot = decodeSyncSnapshot(plaintext, context);
    const conflicting = { ...snapshot, deviceId: 'device-c', assets: snapshot.assets.map((asset) => ({
      ...asset, byteLength: asset.byteLength + 1,
    })) };
    const conflictContext = { vaultId, kind: 'snapshot' as const, objectId: 'device-c' };
    const ciphertext = await crypto.encrypt({ key, context: conflictContext, plaintext: encodeSyncSnapshot(conflicting) });
    server.putSnapshot('device-c', ciphertext);
    const second = await addDevice({ deviceId: 'device-b' });
    const failure = await sync(second).catch((error: unknown) => error);
    expectCoordinatorError(failure, { phase: 'merging', publication: 'not-started', statusRecorded: true });
    expect(await second.db.shortcuts.count()).toBe(0);
});

it('remembers an applied first join when publishing fails and merges peer changes on retry', async () => {
  let failFirstJoinPublish = true;
  server = new SyncObjectServer({ beforePublish: async (objectId) => {
    if (objectId !== 'device-z' || !failFirstJoinPublish) return;
    failFirstJoinPublish = false;
    throw new Error('First join publication failed');
  } });
  const peer = await addDevice({ deviceId: 'device-a', seedWebsite: true });
  const peerShortcut = (await peer.db.shortcuts.toArray())[0];
  expect(peerShortcut).toBeDefined();
  await sync(peer);
  const joining = await addDevice({ deviceId: 'device-z', seedWebsite: true });
  const join = vi.fn(joining.dependencies.algorithms.join);
  const dependencies = { ...joining.dependencies,
    algorithms: { ...joining.dependencies.algorithms, join } };
  const failure = await createSyncCoordinator(dependencies).syncNow().catch((error: unknown) => error);
  expectCoordinatorError(failure, { phase: 'publishing', publication: 'unconfirmed', statusRecorded: true });
  expect((await joining.db.sync_state.get('app'))?.hasAcceptedSnapshot).toBe(true);
  expect((await joining.db.shortcuts.get(peerShortcut!.id))?.title).toBe('Seed website');

  await updateShortcut(peer.db, peerShortcut!.id, { title: 'Peer changed after accepted join' });
  await sync(peer);
  await createSyncCoordinator(dependencies).syncNow();

  expect(join).toHaveBeenCalledOnce();
  expect((await joining.db.shortcuts.get(peerShortcut!.id))?.title).toBe('Peer changed after accepted join');
});

it('keeps a successful local merge and prior success record when conditional publication loses a race', async () => {
    let raceNextPublish = false;
    const hooks: SyncObjectServerHooks = { beforePublish: async (objectId) => {
      if (!raceNextPublish) return;
      raceNextPublish = false;
      const bytes = server.snapshotBytes(objectId);
      if (!bytes) throw new Error('Missing observed snapshot');
      server.putSnapshot(objectId, bytes);
    } };
    const device = await addDevice({ deviceId: 'device-a', seedWebsite: true, hooks });
    const sharedShortcutId = (await device.db.shortcuts.toArray())[0]?.id;
    await sync(device);
    const previousSuccess = (await device.db.sync_state.get('app'))?.lastSuccessfulSync;
    const other = await addDevice({ deviceId: 'device-b' });
    await sync(other);
    await updateShortcut(other.db, sharedShortcutId!, { title: 'Remote merge kept after failed publish' });
    await sync(other);
    raceNextPublish = true;
    const failure = await sync(device).catch((error: unknown) => error);
    expectCoordinatorError(failure, { phase: 'publishing', publication: 'unconfirmed', statusRecorded: true });
    const state = await device.db.sync_state.get('app');
    expect(state?.lastSuccessfulSync).toEqual(previousSuccess);
    expect(state?.lastSync).toMatchObject({ status: 'failed', phase: 'publishing' });
    expect((await device.db.shortcuts.get(sharedShortcutId!))?.title).toBe('Remote merge kept after failed publish');
    await expect(sync(device)).resolves.toMatchObject({ state: 'synced' });
});

it('records an unconfirmed lost publish receipt and confirms it on the next manual run', async () => {
    let loseNextReceipt = false;
    const hooks: SyncObjectServerHooks = { afterPublish: async () => {
      if (!loseNextReceipt) return;
      loseNextReceipt = false;
      throw new Error('Publish receipt connection lost');
    } };
    const device = await addDevice({ deviceId: 'device-a', hooks });
    await sync(device);
    const previousSuccess = (await device.db.sync_state.get('app'))?.lastSuccessfulSync;
    loseNextReceipt = true;
    const failure = await sync(device).catch((error: unknown) => error);
    expectCoordinatorError(failure, { phase: 'publishing', publication: 'unconfirmed', statusRecorded: true });
    expect((await device.db.sync_state.get('app'))?.lastSuccessfulSync).toEqual(previousSuccess);
    expect(server.snapshotBytes('device-a')).toBeDefined();
    await expect(sync(device)).resolves.toMatchObject({ state: 'synced' });
    expect((await device.db.sync_state.get('app'))?.lastSuccessfulSync).toBeDefined();
});

it('retains a successfully uploaded media object after partial failure and does not upload it twice', async () => {
    let attempts = 0;
    const hooks: SyncObjectServerHooks = { beforeCreateAsset: async () => {
      attempts += 1;
      if (attempts === 2) throw new Error('Second asset upload failed');
    } };
    const device = await addDevice({ deviceId: 'device-a', seedImage: true, runIds: ['first-run', 'second-run'], hooks });
    await addFixtureImageShortcut(device.db, 'Second image');
    const failure = await sync(device).catch((error: unknown) => error);
    expectCoordinatorError(failure, { phase: 'uploading-media', publication: 'not-started', statusRecorded: true });
    expect(server.snapshotBytes('device-a')).toBeUndefined();
    await expect(sync(device)).resolves.toMatchObject({ state: 'synced', uploadedAssets: 1 });
    expect(attempts).toBe(3);
    expect(server.events.filter((event) => event.kind === 'publish')).toHaveLength(1);
});
