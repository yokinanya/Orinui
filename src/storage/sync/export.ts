import type { MediaAsset } from '@/domain/asset';
import type { SyncAsset, SyncSnapshotV1 } from '@/domain/sync';
import type { SyncCrypto } from '@/platform/sync-crypto-types';
import type { Database } from '@/storage/db';
import { finalizePendingDeletes } from '@/storage/sync/capture';
import { projectSyncSnapshot, referencedSyncAssetIds } from '@/storage/sync/projection';
import type { SyncRecordRow } from '@/storage/sync/types';
import { readSyncState } from '@/storage/sync/vault';

export interface SyncExport {
  readonly snapshot: SyncSnapshotV1;
  readonly assets: readonly MediaAsset[];
  readonly localGeneration: number;
}

function collectMedia(rows: readonly SyncRecordRow[], assets: readonly MediaAsset[]): Map<string, MediaAsset> {
  const media = new Map(assets.map((asset) => [asset.id, asset]));
  for (const row of rows) {
    if (row.kind !== 'tombstone' && row.retainedAsset && !media.has(row.retainedAsset.id)) {
      media.set(row.retainedAsset.id, row.retainedAsset);
    }
  }
  return media;
}

function verifyLocalMedia(meta: Omit<SyncAsset, 'sha256'>, asset: MediaAsset): void {
  const motion = asset.motion ? { kind: asset.motion.kind, duration: asset.motion.duration } : null;
  if (asset.kind !== meta.kind || asset.mime !== meta.mime || asset.width !== meta.width
    || asset.height !== meta.height || asset.blob.type !== meta.mime || asset.blob.size !== meta.byteLength
    || JSON.stringify(motion) !== JSON.stringify(meta.motion)) {
    throw new Error('同步媒体内容与本机记录不一致');
  }
}

async function describeAsset(input: {
  readonly id: string;
  readonly rows: readonly SyncRecordRow[];
  readonly media: ReadonlyMap<string, MediaAsset>;
  readonly crypto: Pick<SyncCrypto, 'hash'>;
}): Promise<{ readonly reference: SyncAsset; readonly asset: MediaAsset }> {
  const row = input.rows.find((record) => record.kind === 'asset' && record.entityId === input.id);
  const asset = input.media.get(input.id);
  if (!row || row.kind !== 'asset' || !asset) throw new Error('同步图片记录或本机内容不完整');
  const meta = row.value;
  const normalizedMeta = { ...meta, motion: meta.motion ?? null };
  verifyLocalMedia(normalizedMeta, asset);
  const sha256 = await input.crypto.hash(new Uint8Array(await asset.blob.arrayBuffer()));
  if (row.sha256 && row.sha256 !== sha256) throw new Error('同一图片标识的内容已改变');
  return { reference: { ...normalizedMeta, sha256 }, asset: { ...asset, sourceUrl: meta.sourceUrl.value } };
}

/** Reads a consistent local view; expensive hashing runs outside the IndexedDB transaction. */
export async function exportSyncSnapshot(db: Database, crypto: Pick<SyncCrypto, 'hash'>): Promise<SyncExport> {
  await finalizePendingDeletes(db);
  const current = await db.transaction('r', db.sync_state, db.sync_records, db.assets, async () => ({
    state: await readSyncState(db), rows: await db.sync_records.toArray(), assets: await db.assets.toArray(),
  }));
  const media = collectMedia(current.rows, current.assets);
  const described: Awaited<ReturnType<typeof describeAsset>>[] = [];
  for (const id of referencedSyncAssetIds(current.rows)) {
    described.push(await describeAsset({ id, rows: current.rows, media, crypto }));
  }
  return {
    snapshot: projectSyncSnapshot({
      state: current.state, rows: current.rows, assets: described.map(({ reference }) => reference),
    }),
    assets: described.map(({ asset }) => asset), localGeneration: current.state.generation,
  };
}
