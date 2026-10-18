import { expect, it } from 'vitest';
import { createSyncCoordinator } from '@/sync';
import { SharedFifoLock, createTestDevice } from './fixtures/devices';
import { SyncObjectServer } from './server';

it('previews local uploads, remote reads, and object usage without changing sync state', async () => {
  const server = new SyncObjectServer();
  const device = await createTestDevice({ deviceId: 'preview-device', lock: new SharedFifoLock(), server, seedImage: true });
  try {
    const coordinator = createSyncCoordinator(device.dependencies);
    const before = await device.db.sync_state.get('app');
    const initial = await coordinator.previewSizes();
    expect(initial).toMatchObject({ uploadMediaObjects: 1, downloadMediaObjects: 0,
      downloadSnapshotObjects: 0, remoteVaultBytes: 0 });
    expect(initial.uploadMediaBytes).toBeGreaterThan(0);
    expect((await device.db.sync_state.get('app'))).toEqual(before);
    await coordinator.syncNow();
    const next = await coordinator.previewSizes();
    expect(next).toMatchObject({ uploadMediaObjects: 0, downloadMediaObjects: 0,
      downloadSnapshotObjects: 1 });
    expect(next.remoteVaultBytes).toBeGreaterThan(0);
  } finally { await device.db.delete(); }
});
