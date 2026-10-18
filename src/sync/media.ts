import type { MediaAsset } from '@/domain/asset';
import type { SyncAsset, SyncSnapshot } from '@/domain/sync';
import type { SyncLocalExport } from '@/sync/ports';
import type { SyncRunContext } from '@/sync/run-context';
import { parseAssetReceipt, parseObjectRead } from '@/domain/sync/object-validation';
import { SYNC_ENVELOPE_OVERHEAD_BYTES } from '@/platform/sync-crypto-format';
import type { SyncAssetHead } from '@/domain/sync/object-types';
import type { SyncTransferEvent } from '@/sync/ports';

export interface MissingSyncMedia {
  readonly metadata: SyncAsset;
  readonly asset: MediaAsset;
}

export interface PreparedSyncMedia {
  readonly assets: readonly MediaAsset[];
  readonly missing: readonly MissingSyncMedia[];
  readonly downloaded: number;
  readonly repairedAssetIds: readonly string[];
}

interface PrepareMediaInput {
  readonly snapshot: SyncSnapshot;
  readonly local: SyncLocalExport;
  readonly remotes: readonly SyncSnapshot[];
}

interface MediaTransferState {
  readonly metadata: SyncAsset;
  readonly remote: SyncAssetHead | null;
  readonly completedBytes: number;
  readonly totalBytes: number | undefined;
  readonly completedObjects: number;
  readonly totalObjects: number;
}

interface RemoteMediaPlan {
  readonly heads: ReadonlyMap<string, SyncAssetHead | null>;
  readonly needsRead: ReadonlySet<string>;
  readonly totalBytes: number | undefined;
  readonly totalObjects: number;
}

interface ResolvedMedia {
  readonly asset: MediaAsset;
  readonly upload: boolean;
  readonly downloaded: boolean;
  readonly repaired: boolean;
}

async function readMedia(context: SyncRunContext, state: MediaTransferState): Promise<MediaAsset | null> {
  const { metadata, remote } = state;
  await context.dependencies.local.assertCurrent(context.identity);
  const stored = await context.dependencies.objects.readAsset({ vaultId: context.identity.vaultId, objectId: metadata.id,
    ...(remote?.ciphertextBytes === null || remote?.ciphertextBytes === undefined ? {} : { expectedCiphertextBytes: remote.ciphertextBytes }),
    onProgress: (completed, total) => context.dependencies.reportProgress?.({ phase: '接收媒体', objectId: metadata.id,
      completedBytes: state.completedBytes + completed, totalBytes: state.totalBytes,
      completedObjects: state.completedObjects, totalObjects: state.totalObjects }) });
  if (stored === null) return null;
  const object = parseObjectRead(stored);
  return context.dependencies.codec.openImage({ crypto: context.dependencies.crypto, key: context.session.key,
    vaultId: context.identity.vaultId, asset: metadata, ciphertext: object.ciphertext });
}

export async function prepareSyncMedia(context: SyncRunContext, input: PrepareMediaInput): Promise<PreparedSyncMedia> {
  const localMedia = new Map(input.local.assets.map((asset) => [asset.id, asset]));
  const localMetadata = new Map(input.local.snapshot.assets.map((asset) => [asset.id, asset]));
  const remoteReferences = new Set(input.remotes.flatMap((snapshot) => snapshot.assets.map(({ id }) => id)));
  const plan = await inspectRemoteMedia({ context, assets: input.snapshot.assets, localMedia, localMetadata });
  const resolved = await resolveSnapshotMedia({ context, assets: input.snapshot.assets, localMedia, localMetadata,
    remoteReferences, plan });
  return { assets: resolved.assets, missing: resolved.missing, downloaded: resolved.downloaded,
    repairedAssetIds: resolved.repairedAssetIds };
}

function localHashMatches(metadata: SyncAsset, localAsset: MediaAsset | undefined,
  localInfo: SyncLocalExport['snapshot']['assets'][number] | undefined): boolean {
  if (localAsset && localInfo?.sha256 !== metadata.sha256) throw new Error(`本机媒体摘要与同步记录不一致：${metadata.id}`);
  return Boolean(localAsset && localInfo?.sha256 === metadata.sha256);
}

function needsRemoteRead(metadata: SyncAsset, localMatches: boolean, remote: SyncAssetHead | null): boolean {
  return remote !== null && (!localMatches || remote.ciphertextBytes !== metadata.byteLength + SYNC_ENVELOPE_OVERHEAD_BYTES);
}

async function inspectRemoteMedia(input: { readonly context: SyncRunContext; readonly assets: readonly SyncAsset[];
  readonly localMedia: ReadonlyMap<string, MediaAsset>; readonly localMetadata: ReadonlyMap<string, SyncLocalExport['snapshot']['assets'][number]> }): Promise<RemoteMediaPlan> {
  const remoteHeads = new Map<string, SyncAssetHead | null>();
  const needsRead = new Set<string>();
  let downloadTotal = 0;
  let downloadTotalKnown = true;
  let checkedObjects = 0;
  for (const metadata of input.assets) {
    input.context.dependencies.reportProgress?.({ phase: '检查远端媒体', objectId: metadata.id,
      completedObjects: checkedObjects, totalObjects: input.assets.length, totalBytes: undefined });
    const remote = await input.context.dependencies.objects.statAsset({
      vaultId: input.context.identity.vaultId, objectId: metadata.id });
    checkedObjects += 1;
    remoteHeads.set(metadata.id, remote);
    const localMatches = localHashMatches(metadata, input.localMedia.get(metadata.id), input.localMetadata.get(metadata.id));
    if (!needsRemoteRead(metadata, localMatches, remote)) continue;
    needsRead.add(metadata.id);
    if (remote?.ciphertextBytes === null || remote?.ciphertextBytes === undefined) downloadTotalKnown = false;
    else downloadTotal += remote.ciphertextBytes;
  }
  return { heads: remoteHeads, needsRead, totalBytes: downloadTotalKnown ? downloadTotal : undefined,
    totalObjects: needsRead.size };
}

async function resolveMedia(input: { readonly context: SyncRunContext; readonly metadata: SyncAsset;
  readonly localAsset: MediaAsset | undefined; readonly localInfo: SyncLocalExport['snapshot']['assets'][number] | undefined;
  readonly remote: SyncAssetHead | null; readonly needsRead: boolean; readonly localRemoteReference: boolean;
  readonly transfer: { readonly bytes: number; readonly objects: number; readonly totalBytes: number | undefined; readonly totalObjects: number } }): Promise<ResolvedMedia> {
  const { metadata, localAsset, localInfo, remote } = input;
  const localMatches = localHashMatches(metadata, localAsset, localInfo);
  if (localMatches && !input.needsRead) {
    const asset = { ...localAsset!, sourceUrl: metadata.sourceUrl.value, name: metadata.name.value };
    return { asset, upload: remote === null, downloaded: false, repaired: remote === null && input.localRemoteReference };
  }
  if (!remote && !localAsset) throw new Error(`同步媒体内容缺失：${metadata.id}`);
  const received = await readMedia(input.context, { metadata, remote, completedBytes: input.transfer.bytes,
    totalBytes: input.transfer.totalBytes, completedObjects: input.transfer.objects,
    totalObjects: input.transfer.totalObjects });
  if (received) return { asset: received, upload: false, downloaded: true, repaired: false };
  if (!localAsset) throw new Error(`同步图片内容缺失：${metadata.id}`);
  const asset = { ...localAsset, sourceUrl: metadata.sourceUrl.value, name: metadata.name.value };
  return { asset, upload: true, downloaded: false, repaired: input.localRemoteReference };
}

async function resolveSnapshotMedia(input: { readonly context: SyncRunContext; readonly assets: readonly SyncAsset[];
  readonly localMedia: ReadonlyMap<string, MediaAsset>; readonly localMetadata: ReadonlyMap<string, SyncLocalExport['snapshot']['assets'][number]>;
  readonly remoteReferences: ReadonlySet<string>; readonly plan: RemoteMediaPlan }): Promise<{
    readonly assets: MediaAsset[]; readonly missing: MissingSyncMedia[]; readonly downloaded: number; readonly repairedAssetIds: string[];
  }> {
  const assets: MediaAsset[] = [];
  const missing: MissingSyncMedia[] = [];
  const repairedAssetIds: string[] = [];
  let downloaded = 0;
  let transferredBytes = 0;
  let transferredObjects = 0;
  for (const metadata of input.assets) {
    const resolved = await resolveMedia({ context: input.context, metadata,
      localAsset: input.localMedia.get(metadata.id), localInfo: input.localMetadata.get(metadata.id),
      remote: input.plan.heads.get(metadata.id) ?? null, needsRead: input.plan.needsRead.has(metadata.id),
      localRemoteReference: input.remoteReferences.has(metadata.id),
      transfer: { bytes: transferredBytes, objects: transferredObjects,
        totalBytes: input.plan.totalBytes, totalObjects: input.plan.totalObjects } });
    assets.push(resolved.asset);
    if (resolved.upload) missing.push({ metadata, asset: resolved.asset });
    if (resolved.downloaded) {
      downloaded += 1;
      transferredObjects += 1;
      transferredBytes += input.plan.heads.get(metadata.id)?.ciphertextBytes ?? resolved.asset.blob.size + SYNC_ENVELOPE_OVERHEAD_BYTES;
    }
    if (resolved.repaired) repairedAssetIds.push(metadata.id);
  }
  return { assets, missing, downloaded, repairedAssetIds };
}

interface UploadProgressState {
  readonly completedBytes: number;
  readonly totalBytes: number;
  readonly completedObjects: number;
  readonly totalObjects: number;
}

function reportTransfer(context: SyncRunContext, progress: SyncTransferEvent): void {
  context.dependencies.reportProgress?.(progress);
}

async function uploadMedia(context: SyncRunContext, media: MissingSyncMedia, progress: UploadProgressState): Promise<boolean> {
  const { crypto, objects, local, codec } = context.dependencies;
  await local.assertCurrent(context.identity);
  const address = { vaultId: context.identity.vaultId, objectId: media.metadata.id };
  const ciphertext = await crypto.encrypt({ key: context.session.key,
    context: { ...address, kind: 'asset' }, plaintext: new Uint8Array(await media.asset.blob.arrayBuffer()) });
  await local.assertCurrent(context.identity);
  const receipt = parseAssetReceipt(await objects.createAsset({ ...address, ciphertext,
    onProgress: (completedBytes, totalBytes) => reportTransfer(context, { phase: '上传媒体',
      objectId: address.objectId, completedBytes: progress.completedBytes + completedBytes,
      totalBytes: totalBytes === undefined ? undefined : progress.totalBytes,
      completedObjects: progress.completedObjects, totalObjects: progress.totalObjects }) }));
  if (!receipt.created) {
    const stored = await objects.readAsset(address);
    if (stored === null) throw new Error(`已存在媒体的确认对象不存在：${address.objectId}`);
    const object = parseObjectRead(stored);
    if (receipt.revision !== object.revision) throw new Error(`媒体创建回执与实际对象版本不一致：${address.objectId}`);
    await codec.openImage({ crypto, key: context.session.key, vaultId: address.vaultId,
      asset: media.metadata, ciphertext: object.ciphertext });
  }
  return receipt.created;
}

export async function uploadSyncMedia(context: SyncRunContext, media: PreparedSyncMedia): Promise<number> {
  const totalBytes = media.missing.reduce((total, item) => total + item.metadata.byteLength + SYNC_ENVELOPE_OVERHEAD_BYTES, 0);
  if (!Number.isSafeInteger(totalBytes)) throw new Error('预计上传大小超出可计量范围');
  let completedBytes = 0;
  let completedObjects = 0;
  let uploaded = 0;
  for (const missing of media.missing) {
    const created = await uploadMedia(context, missing, { completedBytes, totalBytes, completedObjects,
      totalObjects: media.missing.length });
    completedBytes += missing.metadata.byteLength + SYNC_ENVELOPE_OVERHEAD_BYTES;
    completedObjects += 1;
    reportTransfer(context, { phase: '上传媒体', objectId: missing.metadata.id, completedBytes,
      totalBytes, completedObjects, totalObjects: media.missing.length });
    if (created) uploaded += 1;
  }
  return uploaded;
}
