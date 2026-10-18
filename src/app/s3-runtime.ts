import type { Database } from '@/storage/db';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { createBrowserSyncLock } from '@/platform/sync-lock';
import { createS3ConfigurationStore } from '@/platform/s3-settings';
import { createS3ConnectionDependencies, createS3SyncService } from '@/sync/s3-connection';
import { createWebDavConfigurationStore } from '@/platform/webdav-settings';

export function createS3Runtime(db: Database) {
  const crypto = createSyncCrypto(globalThis.crypto);
  const lock = createBrowserSyncLock(navigator.locks);
  const settings = createS3ConfigurationStore();
  const webDavSettings = createWebDavConfigurationStore();
  const dependencies = createS3ConnectionDependencies({ db, settings, crypto, lock,
    hasWebDavConfiguration: async () => (await webDavSettings.read()) !== null });
  return createS3SyncService(dependencies);
}
