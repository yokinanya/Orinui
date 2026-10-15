import type { MediaAsset } from '@/domain/asset';
import type { SyncAsset, SyncSnapshotV1 } from '@/domain/sync';
import type { SyncLocalExport } from '@/sync/ports';
import type { SyncRunContext } from '@/sync/run-context';
import { parseAssetReceipt, parseObjectRead } from '@/domain/sync/object-validation';

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
  readonly snapshot: SyncSnapshotV1;
  readonly local: SyncLocalExport;
  readonly remotes: readonly SyncSnapshotV1[];
}

async function readMedia(context: SyncRunContext, metadata: SyncAsset): Promise<MediaAsset | null> {
  await context.dependencies.local.assertCurrent(context.identity);
  const stored = await context.dependencies.objects.readAsset({ vaultId: context.identity.vaultId, objectId: metadata.id });
  if (stored === null) return null;
  const object = parseObjectRead(stored);
  return context.dependencies.codec.openImage({ crypto: context.dependencies.crypto, key: context.session.key,
    vaultId: context.identity.vaultId, asset: metadata, ciphertext: object.ciphertext });
}

export async function prepareSyncMedia(context: SyncRunContext, input: PrepareMediaInput): Promise<PreparedSyncMedia> {
  const localMedia = new Map(input.local.assets.map((asset) => [asset.id, asset]));
  const remoteReferences = new Set(input.remotes.flatMap((snapshot) => snapshot.assets.map(({ id }) => id)));
  const assets: MediaAsset[] = [];
  const missing: MissingSyncMedia[] = [];
  const repairedAssetIds: string[] = [];
  let downloaded = 0;
  for (const metadata of input.snapshot.assets) {
    const received = await readMedia(context, metadata);
    if (received) {
      assets.push(received);
      downloaded += 1;
      continue;
    }
    const localAsset = localMedia.get(metadata.id);
    if (!localAsset) throw new Error(`同步图片内容缺失：${metadata.id}`);
    const asset = { ...localAsset, sourceUrl: metadata.sourceUrl.value };
    assets.push(asset);
    missing.push({ metadata, asset });
    if (remoteReferences.has(metadata.id)) repairedAssetIds.push(metadata.id);
  }
  return { assets, missing, downloaded, repairedAssetIds };
}

async function uploadMedia(context: SyncRunContext, media: MissingSyncMedia): Promise<boolean> {
  const { crypto, objects, local, codec } = context.dependencies;
  await local.assertCurrent(context.identity);
  const address = { vaultId: context.identity.vaultId, objectId: media.metadata.id };
  const ciphertext = await crypto.encrypt({ key: context.session.key,
    context: { ...address, kind: 'asset' }, plaintext: new Uint8Array(await media.asset.blob.arrayBuffer()) });
  await local.assertCurrent(context.identity);
  const receipt = parseAssetReceipt(await objects.createAsset({ ...address, ciphertext }));
  const stored = await objects.readAsset(address);
  if (stored === null) throw new Error(`媒体创建后不存在：${address.objectId}`);
  const object = parseObjectRead(stored);
  if (receipt.revision !== object.revision) throw new Error(`媒体创建回执与实际对象版本不一致：${address.objectId}`);
  await codec.openImage({ crypto, key: context.session.key, vaultId: address.vaultId,
    asset: media.metadata, ciphertext: object.ciphertext });
  return receipt.created;
}

export async function uploadSyncMedia(context: SyncRunContext, media: PreparedSyncMedia): Promise<number> {
  let uploaded = 0;
  for (const missing of media.missing) {
    if (await uploadMedia(context, missing)) uploaded += 1;
  }
  return uploaded;
}
