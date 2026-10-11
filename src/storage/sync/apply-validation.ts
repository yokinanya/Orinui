import { fail } from '@/domain/errors';
import { parseSyncSnapshot } from '@/domain/sync';
import type { SyncSnapshotV1 } from '@/domain/sync';
import type { ImageAsset } from '@/domain/asset';
import type { SyncCrypto } from '@/platform/sync-crypto-types';

export interface ValidatedSyncPayload {
  readonly snapshot: SyncSnapshotV1;
  readonly assets: ReadonlyMap<string, ImageAsset>;
}

export interface SyncApplyDependencies {
  readonly crypto: Pick<SyncCrypto, 'hash'>;
  readonly validateImage: (asset: ImageAsset) => Promise<void>;
}

function verifyMetadata(expected: SyncSnapshotV1['assets'][number], asset: ImageAsset): void {
  if (expected.id !== asset.id || expected.kind !== asset.kind || expected.mime !== asset.mime ||
      expected.width !== asset.width || expected.height !== asset.height || expected.byteLength !== asset.blob.size ||
      expected.sourceUrl.value !== asset.sourceUrl) {
    fail(`同步图片元数据与快照不一致：${expected.id}`);
  }
  if (asset.blob.type !== asset.mime) fail(`同步图片 MIME 与 Blob 不一致：${asset.id}`);
}

export async function validateSyncPayload(input: {
  readonly snapshot: unknown;
  readonly assets: readonly ImageAsset[];
}, dependencies: SyncApplyDependencies): Promise<ValidatedSyncPayload> {
  const snapshot = parseSyncSnapshot(input.snapshot);
  const assets = new Map(input.assets.map((asset) => [asset.id, asset]));
  if (assets.size !== input.assets.length || assets.size !== snapshot.assets.length) fail('同步图片资源集合不完整或包含重复标识');
  for (const expected of snapshot.assets) {
    const asset = assets.get(expected.id);
    if (!asset) fail(`同步图片内容缺失：${expected.id}`);
    verifyMetadata(expected, asset);
    const hash = await dependencies.crypto.hash(new Uint8Array(await asset.blob.arrayBuffer()));
    if (hash !== expected.sha256) fail(`同步图片 SHA-256 校验失败：${expected.id}`);
    await dependencies.validateImage(asset);
  }
  return { snapshot, assets };
}
