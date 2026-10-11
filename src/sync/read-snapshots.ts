import type { SyncSnapshotV1 } from '@/domain/sync';
import type { SyncSnapshotHead } from '@/sync/objects';
import type { SyncRunContext } from '@/sync/run-context';
import { parseObjectRead, parseSnapshotHeads } from '@/domain/sync/object-validation';

export interface RemoteSnapshots {
  readonly heads: readonly SyncSnapshotHead[];
  readonly snapshots: readonly SyncSnapshotV1[];
}

export async function readRemoteSnapshots(context: SyncRunContext): Promise<RemoteSnapshots> {
  const { objects, crypto, codec, local } = context.dependencies;
  const { vaultId } = context.identity;
  const heads = parseSnapshotHeads(await objects.listSnapshots({ vaultId }));
  const snapshots: SyncSnapshotV1[] = [];
  for (const head of heads) {
    await local.assertCurrent(context.identity);
    const object = parseObjectRead(await objects.readSnapshot({ vaultId, objectId: head.deviceId, revision: head.revision }));
    if (object.revision !== head.revision) throw new Error(`设备快照版本在读取期间发生变化：${head.deviceId}`);
    const objectContext = { vaultId, kind: 'snapshot' as const, objectId: head.deviceId };
    const plaintext = await crypto.decrypt({ key: context.session.key, context: objectContext, ciphertext: object.ciphertext });
    snapshots.push(codec.decode(plaintext, objectContext));
  }
  return { heads, snapshots };
}
