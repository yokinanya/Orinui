import type { MediaAsset } from '@/domain/asset';
import { parseSyncSnapshot, type SyncAsset, type SyncSnapshot } from '@/domain/sync';
import type { SyncCrypto, SyncObjectContext } from '@/platform/sync-crypto-types';

export function encodeSyncSnapshot(snapshot: SyncSnapshot): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(parseSyncSnapshot(snapshot)));
}

export function decodeSyncSnapshot(bytes: Uint8Array, context: SyncObjectContext): SyncSnapshot {
  const snapshot = parseSyncSnapshot(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (context.kind !== 'snapshot' || snapshot.vaultId !== context.vaultId || snapshot.deviceId !== context.objectId) {
    throw new Error('快照与加密对象身份不一致');
  }
  return snapshot;
}

export async function openSyncImage(input: {
  readonly crypto: SyncCrypto;
  readonly key: CryptoKey;
  readonly vaultId: string;
  readonly asset: SyncAsset;
  readonly ciphertext: Uint8Array;
}): Promise<MediaAsset> {
  const { asset } = input;
  const bytes = await input.crypto.decrypt({
    key: input.key, context: { vaultId: input.vaultId, kind: 'asset', objectId: asset.id },
    ciphertext: input.ciphertext,
  });
  if (bytes.length !== asset.byteLength || await input.crypto.hash(bytes) !== asset.sha256) {
    throw new Error('同步图片校验失败');
  }
  return { id: asset.id, kind: asset.kind, mime: asset.mime, width: asset.width, height: asset.height,
    sourceUrl: asset.sourceUrl.value, name: asset.name.value,
    blob: new Blob([new Uint8Array(bytes)], { type: asset.mime }),
    ...(asset.motion ? { motion: asset.motion } : {}) };
}
