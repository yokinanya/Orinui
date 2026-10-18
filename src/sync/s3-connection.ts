import type { S3Configuration, S3Credentials } from '@/domain/s3-configuration';
import { S3_CONFIGURATION_VERSION, parseS3Credentials } from '@/domain/s3-configuration';
import { mergeSyncSnapshots } from '@/domain/sync';
import { decodeSyncSnapshot, encodeSyncSnapshot, openSyncImage } from '@/platform/sync-codec';
import { createS3Remote, checkS3Bucket, type S3Remote } from '@/platform/s3-store';
import type { SyncCrypto } from '@/platform/sync-crypto-types';
import { checkS3Permission, requestS3Permission, type S3ConfigurationStore } from '@/platform/s3-settings';
import { validateStoredMediaAsset } from '@/platform/media';
import { createWebDavLocalConnection } from '@/storage/webdav-local';
import { createWebDavSyncLocal } from '@/storage/webdav-sync-local';
import type { Database } from '@/storage/db';
import type { SyncLock, SyncProgressReporter, SyncSizePreview } from '@/sync/ports';
import type { SyncRunResult } from '@/sync/types';
import type { SyncRunRecord } from '@/sync/types';
import { createSyncCoordinator } from '@/sync/coordinator';
import { planSyncJoin } from '@/storage/sync/join-plan';
import { countWebDavData, sealWebDavVault, verifyWebDavVault } from '@/sync/webdav-vault';
import type { WebDavLocalConnection } from '@/sync/webdav-types';
import type { S3ConnectionPlan, S3ResetTarget, S3SyncService, S3SyncStatus } from '@/sync/s3-types';
import { S3RecoveryRequiredError } from '@/sync/s3-recovery-required';
import type { S3ConfigurationStore as S3Store } from '@/platform/s3-settings';

interface S3ConnectionDependencies {
  readonly local: WebDavLocalConnection;
  readonly settings: S3Store;
  readonly crypto: SyncCrypto;
  readonly lock: SyncLock;
  readonly createId: () => string;
  readonly hasWebDavConfiguration: () => Promise<boolean>;
  readonly synchronize: (objects: S3Remote['objects'], identity: { readonly vaultId: string; readonly deviceId: string },
    reportProgress?: SyncProgressReporter) => Promise<SyncRunResult>;
  readonly previewSizes: (objects: S3Remote['objects'], identity: { readonly vaultId: string; readonly deviceId: string },
    reportProgress?: SyncProgressReporter) => Promise<SyncSizePreview>;
}

interface PreparedS3Connection {
  readonly plan: S3ConnectionPlan;
  readonly configuration: S3Configuration;
  readonly key: CryptoKey;
  readonly ciphertext: Uint8Array;
  readonly descriptorRevision?: string;
  readonly remote: S3Remote;
}

function statusState(input: { readonly connected: boolean; readonly run?: SyncRunRecord }): S3SyncStatus['state'] {
  if (!input.connected) return 'error';
  const run = input.run;
  if (!run) return 'pending';
  if (run.status === 'running') return 'syncing';
  return run.status === 'failed' ? 'error' : run.pendingEdits ? 'pending' : 'synced';
}

async function localKey(deps: S3ConnectionDependencies, vaultId: string): Promise<CryptoKey> {
  return deps.local.readKey(vaultId);
}

async function verifyDescriptor(deps: S3ConnectionDependencies, remote: S3Remote,
  input: { readonly vaultId: string; readonly key: CryptoKey; readonly revision?: string }): Promise<void> {
  const descriptor = await remote.readVault();
  if (!descriptor || descriptor.vaultId !== input.vaultId
    || (input.revision && descriptor.revision !== input.revision)) {
    throw new Error('S3 远端同步库在确认期间已变化，请重新检查');
  }
  await verifyWebDavVault({ crypto: deps.crypto, key: input.key, vaultId: input.vaultId, ciphertext: descriptor.ciphertext });
}

async function createConnectionPlan(deps: S3ConnectionDependencies, credentials: S3Credentials,
  recoveryKey: string | undefined): Promise<PreparedS3Connection> {
  const remote = createS3Remote(credentials);
  try {
    await checkS3Bucket(credentials);
    const localCountsPromise = deps.local.count();
    const descriptor = await remote.readVault();
    const material = await prepareS3VaultMaterial({ deps, credentials, descriptor, recoveryKey, localCountsPromise });
    await verifyWebDavVault({ crypto: deps.crypto, key: material.key, vaultId: material.vaultId, ciphertext: material.ciphertext });
    const [local, remoteCounts, remoteObjectBytes] = await Promise.all([
      localCountsPromise,
      descriptor ? countWebDavData({ objects: remote.objects, crypto: deps.crypto, key: material.key,
        vaultId: material.vaultId, decodeSnapshot: decodeSyncSnapshot }) : Promise.resolve({ folders: 0, shortcuts: 0, assets: 0, assetBytes: 0 }),
      descriptor ? remote.listVaultBytes(material.vaultId) : Promise.resolve(0),
    ]);
    const configuration: S3Configuration = { schemaVersion: S3_CONFIGURATION_VERSION, vaultId: material.vaultId,
      deviceId: deps.createId(), credentials };
    const plan: S3ConnectionPlan = { mode: descriptor ? 'join' : 'create', endpoint: credentials.endpoint,
      bucket: credentials.bucket, prefix: credentials.prefix, recoveryKey: material.recoveryKey, local,
      remote: remoteCounts, remoteObjectBytes };
    return { plan, configuration, key: material.key, ciphertext: material.ciphertext,
      ...(descriptor ? { descriptorRevision: descriptor.revision } : {}), remote };
  } catch (cause) {
    remote.dispose();
    throw cause;
  }
}

async function prepareS3VaultMaterial(input: { readonly deps: S3ConnectionDependencies; readonly credentials: S3Credentials;
  readonly descriptor: Awaited<ReturnType<S3Remote['readVault']>>; readonly recoveryKey: string | undefined;
  readonly localCountsPromise: Promise<Awaited<ReturnType<WebDavLocalConnection['count']>>> }) {
  const { deps, credentials, descriptor, recoveryKey, localCountsPromise } = input;
  if (descriptor && !recoveryKey) {
    await localCountsPromise;
    const configuration: S3Configuration = { schemaVersion: S3_CONFIGURATION_VERSION, vaultId: descriptor.vaultId,
      deviceId: deps.createId(), credentials };
    throw new S3RecoveryRequiredError(credentials, { configuration, vaultId: descriptor.vaultId,
      descriptorRevision: descriptor.revision });
  }
  if (recoveryKey && !descriptor) throw new Error('未找到同步库，请确认 bucket 与 prefix；创建新库请清空恢复密钥');
  const keyMaterial = descriptor ? { key: await deps.crypto.importKey(recoveryKey!), recoveryKey: undefined }
    : await deps.crypto.createKey();
  const vaultId = descriptor?.vaultId ?? deps.createId();
  const ciphertext = descriptor?.ciphertext ?? await sealWebDavVault({ crypto: deps.crypto, key: keyMaterial.key, vaultId });
  return { key: keyMaterial.key, recoveryKey: keyMaterial.recoveryKey, vaultId, ciphertext };
}

async function connectPrepared(deps: S3ConnectionDependencies, prepared: PreparedS3Connection,
  reportProgress?: SyncProgressReporter): Promise<void> {
  const { configuration, key, remote } = prepared;
  await checkS3Permission(configuration.credentials.endpoint);
  await deps.lock.runExclusive(deps.local.scope, async () => {
    if (await deps.local.read() || await deps.settings.read() || await deps.hasWebDavConfiguration()) {
      throw new Error('本机已有同步提供方，请先断开当前连接');
    }
    if (prepared.plan.mode === 'join') await verifyDescriptor(deps, remote, {
      vaultId: configuration.vaultId, key, revision: prepared.descriptorRevision,
    });
    await remote.verifyConditions(configuration);
    if (prepared.plan.mode === 'create') await remote.createVault({ vaultId: configuration.vaultId, ciphertext: prepared.ciphertext });
    await deps.local.initialize({ vaultId: configuration.vaultId, deviceId: configuration.deviceId, key });
    await deps.settings.write(configuration);
  });
  await deps.synchronize(remote.objects, configuration, reportProgress);
}

async function synchronizeConnected(deps: S3ConnectionDependencies, reportProgress?: SyncProgressReporter): Promise<SyncRunResult> {
  const configuration = await deps.settings.read();
  if (!configuration) throw new Error('S3 同步尚未连接');
  await checkS3Permission(configuration.credentials.endpoint);
  const local = await deps.local.read();
  if (!local || local.vaultId !== configuration.vaultId || local.deviceId !== configuration.deviceId) {
    throw new Error('本机 S3 连接身份不一致，请断开后重新连接');
  }
  const remote = createS3Remote(configuration.credentials);
  try {
    await verifyDescriptor(deps, remote, { vaultId: configuration.vaultId,
      key: await localKey(deps, configuration.vaultId) });
    return await deps.synchronize(remote.objects, configuration, reportProgress);
  } finally { remote.dispose(); }
}

async function previewConnected(deps: S3ConnectionDependencies, reportProgress?: SyncProgressReporter): Promise<SyncSizePreview> {
  const configuration = await deps.settings.read();
  if (!configuration) throw new Error('S3 同步尚未连接');
  await checkS3Permission(configuration.credentials.endpoint);
  const local = await deps.local.read();
  if (!local || local.vaultId !== configuration.vaultId || local.deviceId !== configuration.deviceId) {
    throw new Error('本机 S3 连接身份不一致，请断开后重新连接');
  }
  const remote = createS3Remote(configuration.credentials);
  try {
    await verifyDescriptor(deps, remote, { vaultId: configuration.vaultId, key: await localKey(deps, configuration.vaultId) });
    return await deps.previewSizes(remote.objects, configuration, reportProgress);
  } finally { remote.dispose(); }
}

async function deleteConnectedVault(deps: S3ConnectionDependencies): Promise<void> {
  const expected = await deps.settings.read();
  if (!expected) throw new Error('S3 同步尚未连接');
  await checkS3Permission(expected.credentials.endpoint);
  await deps.lock.runExclusive(deps.local.scope, async () => {
    const configuration = await deps.settings.read();
    const local = await deps.local.read();
    if (!configuration || JSON.stringify(configuration) !== JSON.stringify(expected) || !local
      || local.vaultId !== expected.vaultId || local.deviceId !== expected.deviceId) {
      throw new Error('本机 S3 连接身份已变化，拒绝删除远端同步库');
    }
    const remote = createS3Remote(configuration.credentials);
    try {
      const key = await localKey(deps, local.vaultId);
      await verifyDescriptor(deps, remote, { vaultId: configuration.vaultId, key });
      const descriptor = await remote.readVault();
      if (!descriptor) throw new Error('S3 远端同步库不存在');
      await remote.deleteVault(configuration.vaultId, descriptor.revision);
      await deps.settings.remove();
      await deps.local.disconnect();
    } finally { remote.dispose(); }
  });
}

interface S3ServiceState { prepared: PreparedS3Connection | null; resetTarget: S3ResetTarget | null }

async function readS3Status(deps: S3ConnectionDependencies): Promise<S3SyncStatus | null> {
  const configuration = await deps.settings.read();
  if (!configuration) return null;
  const local = await deps.local.read();
  const connected = Boolean(local && local.vaultId === configuration.vaultId && local.deviceId === configuration.deviceId);
  return { endpoint: configuration.credentials.endpoint, bucket: configuration.credentials.bucket,
    prefix: configuration.credentials.prefix, vaultId: configuration.vaultId, deviceId: configuration.deviceId,
    state: statusState({ connected, run: local?.lastSync }), lastSuccessfulSyncAt: local?.lastSuccessfulSync?.at,
    ...(local?.lastSync?.error ? { error: local.lastSync.error.message } : {}) };
}

function cancelS3Plan(state: S3ServiceState): void {
  state.prepared?.remote.dispose();
  state.prepared = null;
  state.resetTarget = null;
}

async function prepareS3Connection(deps: S3ConnectionDependencies, state: S3ServiceState,
  input: { readonly credentials: S3Credentials; readonly recoveryKey?: string }): Promise<S3ConnectionPlan> {
  cancelS3Plan(state);
  const credentials = parseS3Credentials(input.credentials);
  const permission = requestS3Permission(credentials.endpoint);
  const [local, current, hasWebDav] = await Promise.all([
    deps.local.read(), deps.settings.read(), deps.hasWebDavConfiguration(), permission,
  ]);
  if (local || current || hasWebDav) throw new Error('请先断开当前同步库');
  try { state.prepared = await createConnectionPlan(deps, credentials, input.recoveryKey); }
  catch (cause) {
    if (cause instanceof S3RecoveryRequiredError) state.resetTarget = cause.target;
    throw cause;
  }
  return state.prepared.plan;
}

async function connectS3Connection(deps: S3ConnectionDependencies, state: S3ServiceState,
  reportProgress?: SyncProgressReporter): Promise<void> {
  if (!state.prepared) throw new Error('请先检查 S3 连接');
  const current = state.prepared;
  try { await connectPrepared(deps, current, reportProgress); }
  finally { current.remote.dispose(); state.prepared = null; }
}

async function disconnectS3Connection(deps: S3ConnectionDependencies): Promise<void> {
  await deps.lock.runExclusive(deps.local.scope, async () => {
    await deps.settings.remove();
    await deps.local.disconnect();
  });
}

async function resetS3Connection(deps: S3ConnectionDependencies, state: S3ServiceState,
  target: S3ResetTarget): Promise<void> {
  if (!state.resetTarget || JSON.stringify(target) !== JSON.stringify(state.resetTarget)) throw new Error('S3 重置目标已失效，请重新检查');
  await requestS3Permission(target.configuration.credentials.endpoint);
  await deps.lock.runExclusive(deps.local.scope, async () => {
    if (await deps.local.read() || await deps.settings.read() || await deps.hasWebDavConfiguration()) {
      throw new Error('本机已连接同步库，请使用已连接面板删除');
    }
    await deleteCheckedRemote(target);
  });
  cancelS3Plan(state);
}

async function deleteCheckedRemote(target: S3ResetTarget): Promise<void> {
  const remote = createS3Remote(target.configuration.credentials);
  try {
    const descriptor = await remote.readVault();
    if (!descriptor || descriptor.vaultId !== target.vaultId || descriptor.revision !== target.descriptorRevision) {
      throw new Error('S3 同步库在确认期间已变化，请重新检查');
    }
    await remote.deleteVault(target.vaultId, target.descriptorRevision);
  } finally { remote.dispose(); }
}

export function createS3SyncService(deps: S3ConnectionDependencies): S3SyncService {
  const state: S3ServiceState = { prepared: null, resetTarget: null };
  return { read: () => readS3Status(deps),
    prepare: (input) => prepareS3Connection(deps, state, input),
    connect: (progress) => connectS3Connection(deps, state, progress),
    cancelPlan: () => cancelS3Plan(state),
    syncNow: (progress) => synchronizeConnected(deps, progress),
    previewSizes: (progress) => previewConnected(deps, progress),
    disconnect: () => disconnectS3Connection(deps),
    deleteRemote: () => deleteConnectedVault(deps),
    resetRemote: (target) => resetS3Connection(deps, state, target) };
}

interface S3ConnectionDependenciesInput {
  readonly db: Database; readonly settings: S3ConfigurationStore; readonly crypto: SyncCrypto; readonly lock: SyncLock;
  readonly hasWebDavConfiguration: () => Promise<boolean>;
}

export function createS3ConnectionDependencies(input: S3ConnectionDependenciesInput): S3ConnectionDependencies {
  const { db, settings, crypto, lock, hasWebDavConfiguration } = input;
  const local = createWebDavLocalConnection(db);
  const coordinator = (objects: S3Remote['objects'], identity: { readonly vaultId: string; readonly deviceId: string },
    reportProgress?: SyncProgressReporter) => createSyncCoordinator({
      local: createWebDavSyncLocal({ db, identity, dependencies: { crypto, validateStoredMediaAsset } }), objects, lock, crypto,
      codec: { encode: encodeSyncSnapshot, decode: decodeSyncSnapshot, openImage: openSyncImage },
      algorithms: { merge: mergeSyncSnapshots, join: planSyncJoin }, now: Date.now, createRunId: () => globalThis.crypto.randomUUID(), reportProgress,
    });
  return { local, settings, crypto, lock, createId: () => globalThis.crypto.randomUUID(), hasWebDavConfiguration,
    synchronize: (objects, identity, reportProgress) => coordinator(objects, identity, reportProgress).syncNow(),
    previewSizes: (objects, identity, reportProgress) => coordinator(objects, identity, reportProgress).previewSizes(reportProgress) };
}
