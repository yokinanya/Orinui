import type { Database } from '@/storage/db';
import { createWebDavLocalConnection } from '@/storage/webdav-local';
import { createWebDavSyncLocal } from '@/storage/webdav-sync-local';
import { planSyncJoin } from '@/storage/sync/join-plan';
import { mergeSyncSnapshots } from '@/domain/sync';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { decodeSyncSnapshot, encodeSyncSnapshot, openSyncImage } from '@/platform/sync-codec';
import { validateStoredMediaAsset } from '@/platform/media';
import { createBrowserSyncLock } from '@/platform/sync-lock';
import { createWebDavRemote } from '@/platform/webdav-store';
import { checkWebDavPermission, createWebDavConfigurationStore, requestWebDavPermission } from '@/platform/webdav-settings';
import { createWebDavSyncService } from '@/sync/webdav-connection';
import { createS3ConfigurationStore } from '@/platform/s3-settings';
import { createSyncCoordinator } from '@/sync/coordinator';

export function createWebDavRuntime(db: Database) {
  const cipher = createSyncCrypto(crypto);
  const lock = createBrowserSyncLock(navigator.locks);
  const coordinator = (objects: import('@/sync/objects').SyncObjectStore,
    identity: { readonly vaultId: string; readonly deviceId: string }, reportProgress?: import('@/sync/ports').SyncProgressReporter) =>
    createSyncCoordinator({
      local: createWebDavSyncLocal({ db, identity, dependencies: { crypto: cipher, validateStoredMediaAsset } }), objects, lock, crypto: cipher,
      codec: { encode: encodeSyncSnapshot, decode: decodeSyncSnapshot, openImage: openSyncImage },
      algorithms: { merge: mergeSyncSnapshots, join: planSyncJoin }, now: Date.now, createRunId: () => crypto.randomUUID(), reportProgress,
    });
  const s3Settings = createS3ConfigurationStore();
  return createWebDavSyncService({
    local: createWebDavLocalConnection(db), settings: createWebDavConfigurationStore(), crypto: cipher, lock,
    decodeSnapshot: decodeSyncSnapshot,
    requestPermission: requestWebDavPermission, checkPermission: checkWebDavPermission,
    hasOtherProviderConfiguration: async () => (await s3Settings.read()) !== null,
    createId: () => crypto.randomUUID(),
    remote: (credentials, consistencyMode) => createWebDavRemote({ credentials, consistencyMode, fetch: (url, init) => fetch(url, init),
      parseXml: (source) => new DOMParser().parseFromString(source, 'application/xml') }),
    synchronize: (objects, identity, reportProgress) => coordinator(objects, identity, reportProgress).syncNow(),
    previewSizes: (objects, identity, reportProgress) => coordinator(objects, identity, reportProgress).previewSizes(reportProgress),
  });
}
