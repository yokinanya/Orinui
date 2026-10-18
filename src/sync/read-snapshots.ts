import type { SyncSnapshot } from '@/domain/sync';
import type { SyncSnapshotHead } from '@/sync/objects';
import type { SyncRunContext } from '@/sync/run-context';
import { parseObjectRead, parseSnapshotHeads } from '@/domain/sync/object-validation';

export interface RemoteSnapshots {
  readonly heads: readonly SyncSnapshotHead[];
  readonly snapshots: readonly SyncSnapshot[];
}

export async function readRemoteSnapshots(context: SyncRunContext): Promise<RemoteSnapshots> {
  const { objects, crypto, codec, local } = context.dependencies;
  const { vaultId } = context.identity;
  const heads = parseSnapshotHeads(await objects.listSnapshots({ vaultId }));
  const snapshots: SyncSnapshot[] = [];
  const sizesKnown = heads.every(({ ciphertextBytes }) => ciphertextBytes !== undefined);
  const totalBytes = sizesKnown ? heads.reduce((total, head) => total + (head.ciphertextBytes ?? 0), 0) : undefined;
  let completedBytes = 0;
  for (const [index, head] of heads.entries()) {
    await local.assertCurrent(context.identity);
    const object = parseObjectRead(await objects.readSnapshot({ vaultId, objectId: head.deviceId, revision: head.revision,
      ...(head.ciphertextBytes === undefined ? {} : { expectedCiphertextBytes: head.ciphertextBytes }),
      onProgress: (completed, total) => context.dependencies.reportProgress?.({ phase: '读取远端快照',
        objectId: head.deviceId, completedBytes: completedBytes + completed, totalBytes: totalBytes ?? total,
        completedObjects: index, totalObjects: heads.length }) }));
    if (object.revision !== head.revision) throw new Error(`设备快照版本在读取期间发生变化：${head.deviceId}`);
    const objectContext = { vaultId, kind: 'snapshot' as const, objectId: head.deviceId };
    const plaintext = await crypto.decrypt({ key: context.session.key, context: objectContext, ciphertext: object.ciphertext });
    snapshots.push(codec.decode(plaintext, objectContext));
    completedBytes += object.ciphertext.byteLength;
  }
  return { heads, snapshots };
}
