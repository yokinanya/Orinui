import { expect, it } from 'vitest';
import { deleteShortcut } from '@/storage/shortcuts';
import { SHORTCUT_UNDO_WINDOW_MS } from '@/storage/sync/capture';
import { createSyncCoordinator, SyncCoordinatorError } from '@/sync';
import { createTestDevice, SharedFifoLock } from './fixtures/devices';
import { SyncObjectServer } from './server';

it('does not revive a deletion whose undo window expires while reading remote data', async () => {
  const INITIAL_TIME = 10_000;
  let now = INITIAL_TIME;
  let advanceDuringRead = false;
  const server = new SyncObjectServer({ afterListSnapshots: async () => {
    if (advanceDuringRead) { advanceDuringRead = false; now += SHORTCUT_UNDO_WINDOW_MS; }
  } });
  const device = await createTestDevice({ deviceId: 'undo-device', seedImage: true, server,
    lock: new SharedFifoLock(), now: () => now });
  try {
    const coordinator = createSyncCoordinator(device.dependencies);
    await coordinator.syncNow();
    const shortcut = (await device.db.shortcuts.toArray())[0]!;
    await deleteShortcut(device.db, shortcut.id);
    advanceDuringRead = true;
    const failure = await coordinator.syncNow().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SyncCoordinatorError);
    expect(failure).toMatchObject({ phase: 'applying', publication: 'not-started' });
    expect(await device.db.shortcuts.get(shortcut.id)).toBeUndefined();
    await expect(coordinator.syncNow()).resolves.toMatchObject({ state: 'synced' });
    expect(await device.db.shortcuts.get(shortcut.id)).toBeUndefined();
    expect((await device.db.sync_records.get(`shortcut:${shortcut.id}`))?.kind).toBe('tombstone');
  } finally { await device.db.delete(); }
});
