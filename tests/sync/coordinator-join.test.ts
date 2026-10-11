import { afterEach, beforeEach, expect, it } from 'vitest';
import { updateShortcut } from '@/storage/shortcuts';
import { createSyncCoordinator } from '@/sync/coordinator';
import { crypto, createTestDevice, deleteDevices, SharedFifoLock, type TestDevice } from './fixtures/devices';
import { SyncObjectServer } from './server';

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

async function addDevice(input: { readonly deviceId: string; readonly seedImage?: boolean; readonly seedWebsite?: boolean }): Promise<TestDevice> {
  const device = await createTestDevice({ ...input, recoveryKey, lock, server });
  devices.push(device);
  return device;
}

async function sync(device: TestDevice) {
  return createSyncCoordinator(device.dependencies).syncNow();
}

it('joins a blank device and restores actual encrypted image bytes after publishing media first', async () => {
    const first = await addDevice({ deviceId: 'device-a', seedImage: true });
    const firstResult = await sync(first);
    expect(firstResult.state).toBe('synced');
    const firstPublishIndex = server.events.findIndex((event) => event.kind === 'publish' && event.objectId === 'device-a');
    const firstAssetIndex = server.events.findIndex((event) => event.kind === 'create-asset');
    expect(firstAssetIndex).toBeGreaterThanOrEqual(0);
    expect(firstAssetIndex).toBeLessThan(firstPublishIndex);

    const second = await addDevice({ deviceId: 'device-b' });
    const joined = await sync(second);
    expect(joined.state).toBe('synced');
    expect(await second.db.shortcuts.count()).toBe(1);
    const asset = (await second.db.assets.toArray())[0];
    expect(asset).toBeDefined();
    expect(server.events.filter((event) => event.kind === 'create-asset')).toHaveLength(1);
    expect([...new Uint8Array(await asset!.blob.arrayBuffer()).slice(0, 8)])
      .toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const secondPublishIndex = server.events.findIndex((event) => event.kind === 'publish' && event.objectId === 'device-b');
    const receivedAssetIndex = server.events.findIndex((event) => event.kind === 'read-asset' && event.objectId === asset!.id);
    expect(receivedAssetIndex).toBeLessThan(secondPublishIndex);
});

it('preserves existing local websites and combines concurrent independent shortcut fields', async () => {
    const first = await addDevice({ deviceId: 'device-a', seedWebsite: true });
    const firstLocalId = (await first.db.shortcuts.toArray())[0]?.id;
    await sync(first);
    const second = await addDevice({ deviceId: 'device-b', seedWebsite: true });
    const secondLocalId = (await second.db.shortcuts.toArray())[0]?.id;
    await sync(second);
    expect(await second.db.shortcuts.count()).toBe(2);
    expect(await second.db.shortcuts.get(secondLocalId!)).toBeDefined();

    await sync(first);
    const firstShortcut = await first.db.shortcuts.get(firstLocalId!);
    const secondShortcut = firstShortcut ? await second.db.shortcuts.get(firstShortcut.id) : undefined;
    expect(firstShortcut).toBeDefined();
    expect(secondShortcut).toBeDefined();
    await updateShortcut(first.db, firstShortcut!.id, { title: 'Edited title' });
    await updateShortcut(second.db, secondShortcut!.id, { url: 'https://edited.example.test/' });

    await sync(first);
    await sync(second);
    await sync(first);
    const mergedFirst = await first.db.shortcuts.get(firstShortcut!.id);
    const mergedSecond = await second.db.shortcuts.get(firstShortcut!.id);
    expect(mergedFirst).toMatchObject({ title: 'Edited title', url: 'https://edited.example.test/' });
    expect(mergedSecond).toMatchObject({ title: 'Edited title', url: 'https://edited.example.test/' });
});
