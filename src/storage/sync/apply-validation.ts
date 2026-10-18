import { fail } from '@/domain/errors';
import { parseSyncSnapshot } from '@/domain/sync';
import type { SyncSnapshot } from '@/domain/sync';
import type { MediaAsset } from '@/domain/asset';
import type { SyncCrypto } from '@/platform/sync-crypto-types';

export interface ValidatedSyncPayload {
  readonly snapshot: SyncSnapshot;
  readonly assets: ReadonlyMap<string, MediaAsset>;
}

export interface SyncApplyDependencies {
  readonly crypto: Pick<SyncCrypto, 'hash'>;
  readonly validateStoredMediaAsset: (asset: MediaAsset) => Promise<MediaAsset>;
}

function verifyIdentityMetadata(expected: SyncSnapshot['assets'][number], asset: MediaAsset): void {
  if (expected.id !== asset.id || expected.kind !== asset.kind || expected.mime !== asset.mime ||
      expected.width !== asset.width || expected.height !== asset.height || expected.byteLength !== asset.blob.size ||
      expected.sourceUrl.value !== asset.sourceUrl) {
    fail(`同步媒体元数据与快照不一致：${expected.id}`);
  }
}

function verifyMotionMetadata(expected: SyncSnapshot['assets'][number], asset: MediaAsset): void {
  const motion = asset.motion ? { kind: asset.motion.kind, duration: asset.motion.duration } : null;
  if (JSON.stringify(expected.motion) !== JSON.stringify(motion)) fail(`同步媒体动态属性与快照不一致：${expected.id}`);
}

function verifyMetadata(expected: SyncSnapshot['assets'][number], asset: MediaAsset): void {
  verifyIdentityMetadata(expected, asset);
  verifyMotionMetadata(expected, asset);
  if (asset.blob.type !== asset.mime) fail(`同步媒体 MIME 与 Blob 不一致：${asset.id}`);
}

export async function validateSyncPayload(input: {
  readonly snapshot: unknown;
  readonly assets: readonly MediaAsset[];
}, dependencies: SyncApplyDependencies): Promise<ValidatedSyncPayload> {
  const snapshot = parseSyncSnapshot(input.snapshot);
  const receivedAssets = new Map(input.assets.map((asset) => [asset.id, asset]));
  if (receivedAssets.size !== input.assets.length || receivedAssets.size !== snapshot.assets.length) fail('同步媒体集合不完整或包含重复标识');
  const assets = new Map<string, MediaAsset>();
  for (const expected of snapshot.assets) {
    const asset = receivedAssets.get(expected.id);
    if (!asset) fail(`同步媒体内容缺失：${expected.id}`);
    verifyMetadata(expected, asset);
    const hash = await dependencies.crypto.hash(new Uint8Array(await asset.blob.arrayBuffer()));
    if (hash !== expected.sha256) fail(`同步媒体 SHA-256 校验失败：${expected.id}`);
    const validated = await dependencies.validateStoredMediaAsset(asset);
    verifyMetadata(expected, validated);
    if (validated.motion && !validated.motion.poster) fail(`动态媒体封面生成失败：${expected.id}`);
    assets.set(validated.id, validated);
  }
  return { snapshot, assets };
}
