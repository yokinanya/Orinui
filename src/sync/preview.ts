import type { SyncSnapshot } from '@/domain/sync';
import { mergeSyncSnapshots } from '@/domain/sync';
import { SYNC_ENVELOPE_OVERHEAD_BYTES } from '@/platform/sync-crypto-format';
import { parseObjectRead, parseSnapshotHeads } from '@/domain/sync/object-validation';
import type { SyncCoordinatorDependencies, SyncSizePreview, SyncTransferEvent } from '@/sync/ports';
import type { SyncProgressReporter } from '@/sync/ports';

function optionalSum(values: readonly (number | undefined)[]): number | null {
  if (values.some((value) => value === undefined)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  if (!Number.isSafeInteger(total)) throw new Error('远端快照总字节数超出可计量范围');
  return total;
}

type LocalExport = Awaited<ReturnType<SyncCoordinatorDependencies['local']['preview']>>['local'];
type AssetTransferDecision = { readonly direction: 'none' } | { readonly direction: 'download'; readonly bytes: number | null }
  | { readonly direction: 'upload'; readonly bytes: number };

function classifyAssetTransfer(input: { readonly asset: SyncSnapshot['assets'][number]; readonly localAsset: LocalExport['assets'][number] | undefined;
  readonly localHash: string | undefined; readonly remoteBytes: number | null | undefined; readonly remoteExists: boolean }): AssetTransferDecision {
  const { asset, localAsset, localHash, remoteBytes, remoteExists } = input;
  if (localAsset && localHash !== asset.sha256) throw new Error(`本机媒体摘要与同步记录不一致：${asset.id}`);
  const localMatches = Boolean(localAsset && localHash === asset.sha256);
  if (!remoteExists) return uploadDecision(asset, localMatches);
  if (localMatches && remoteBytes === asset.byteLength + SYNC_ENVELOPE_OVERHEAD_BYTES) return { direction: 'none' };
  return { direction: 'download', bytes: remoteBytes ?? null };
}

function uploadDecision(asset: SyncSnapshot['assets'][number], localMatches: boolean): AssetTransferDecision {
  if (!localMatches) throw new Error(`本机和远端都缺少媒体内容：${asset.id}`);
  return { direction: 'upload', bytes: asset.byteLength + SYNC_ENVELOPE_OVERHEAD_BYTES };
}

function countSnapshotAssetTransfer(input: { readonly snapshot: SyncSnapshot; readonly local: LocalExport;
  readonly remoteBytes: ReadonlyMap<string, number | null> }): {
  readonly downloadCount: number; readonly downloadBytes: number | null; readonly uploadCount: number; readonly uploadBytes: number;
} {
  const localAssets = new Map(input.local.assets.map((asset) => [asset.id, asset]));
  const localMeta = new Map(input.local.snapshot.assets.map((asset) => [asset.id, asset]));
  let downloadCount = 0;
  let uploadCount = 0;
  let downloadUnknown = false;
  let downloadBytes = 0;
  let uploadBytes = 0;
  for (const asset of input.snapshot.assets) {
    const remoteBytes = input.remoteBytes.get(asset.id);
    const remoteExists = input.remoteBytes.has(asset.id) && remoteBytes !== null;
    const decision = classifyAssetTransfer({ asset, localAsset: localAssets.get(asset.id),
      localHash: localMeta.get(asset.id)?.sha256, remoteBytes, remoteExists });
    if (decision.direction === 'download') {
      downloadCount += 1;
      if (decision.bytes === null) downloadUnknown = true;
      else downloadBytes += decision.bytes;
    }
    if (decision.direction === 'upload') { uploadCount += 1; uploadBytes += decision.bytes; }
  }
  if (!Number.isSafeInteger(downloadBytes) || !Number.isSafeInteger(uploadBytes)) throw new Error('媒体传输量超出可计量范围');
  return { downloadCount, downloadBytes: downloadUnknown ? null : downloadBytes, uploadCount, uploadBytes };
}

async function readSnapshots(deps: SyncCoordinatorDependencies, input: {
  readonly vaultId: string; readonly key: CryptoKey; readonly reporter?: SyncProgressReporter;
}): Promise<{ readonly heads: Awaited<ReturnType<SyncCoordinatorDependencies['objects']['listSnapshots']>>; readonly snapshots: SyncSnapshot[] }> {
  const heads = parseSnapshotHeads(await deps.objects.listSnapshots({ vaultId: input.vaultId }));
  const snapshots: SyncSnapshot[] = [];
  let index = 0;
  for (const head of heads) {
    input.reporter?.({ phase: '读取远端快照', objectId: head.deviceId, completedObjects: index,
      totalObjects: heads.length, totalBytes: undefined });
    const object = parseObjectRead(await deps.objects.readSnapshot({ vaultId: input.vaultId,
      objectId: head.deviceId, revision: head.revision }));
    if (object.revision !== head.revision) throw new Error(`设备快照预览期间发生变化：${head.deviceId}`);
    const context = { vaultId: input.vaultId, kind: 'snapshot' as const, objectId: head.deviceId };
    const plaintext = await deps.crypto.decrypt({ key: input.key, context, ciphertext: object.ciphertext });
    snapshots.push(deps.codec.decode(plaintext, context));
    index += 1;
  }
  return { heads, snapshots };
}

export async function previewSyncSize(input: {
  readonly dependencies: SyncCoordinatorDependencies;
  readonly now: () => number;
  readonly reporter?: SyncProgressReporter;
}): Promise<SyncSizePreview> {
  const { dependencies, now, reporter } = input;
  return dependencies.lock.runExclusive(dependencies.local.scope, async () => {
    const { session, local } = await dependencies.local.preview();
    const remote = await readSnapshots(dependencies, { vaultId: session.vaultId, key: session.key, reporter });
    const own = remote.heads.some(({ deviceId }) => deviceId === session.deviceId);
    const mergeInput = { local: local.snapshot, remotes: remote.snapshots };
    const snapshot = !session.hasBaseline && !own && remote.snapshots.length > 0
      ? dependencies.algorithms.join(mergeInput) : dependencies.algorithms.merge(mergeInput);
    const remoteBytes = new Map<string, number | null>();
    let index = 0;
    for (const asset of snapshot.assets) {
      reporter?.({ phase: '检查远端媒体', objectId: asset.id, completedObjects: index,
        totalObjects: snapshot.assets.length, totalBytes: undefined });
      const stat = await dependencies.objects.statAsset({ vaultId: session.vaultId, objectId: asset.id });
      if (stat) remoteBytes.set(asset.id, stat.ciphertextBytes);
      index += 1;
    }
    const media = countSnapshotAssetTransfer({ snapshot, local, remoteBytes });
    const plaintextSnapshot = dependencies.codec.encode(snapshot);
    const uploadSnapshotBytes = plaintextSnapshot.byteLength + SYNC_ENVELOPE_OVERHEAD_BYTES;
    const localMediaBytes = local.assets.reduce((total, asset) => total + asset.blob.size, 0);
    if (!Number.isSafeInteger(uploadSnapshotBytes) || !Number.isSafeInteger(localMediaBytes)) {
      throw new Error('同步容量超出可计量范围');
    }
    const snapshotBytes = optionalSum(remote.heads.map(({ ciphertextBytes }) => ciphertextBytes));
    const remoteVaultBytes = await dependencies.objects.measureVaultBytes({ vaultId: session.vaultId,
      onObjectProgress: (objectsCompleted) => reporter?.({ phase: '统计远端占用', completedObjects: objectsCompleted,
        totalBytes: undefined }) });
    return { measuredAt: now(), localMediaBytes, remoteVaultBytes,
      downloadMediaObjects: media.downloadCount, downloadMediaBytes: media.downloadBytes,
      uploadMediaObjects: media.uploadCount, uploadMediaBytes: media.uploadBytes,
      downloadSnapshotObjects: remote.heads.length, downloadSnapshotBytes: snapshotBytes, uploadSnapshotBytes };
  });
}
