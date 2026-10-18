import type { SyncObjectAddress, SyncSnapshotHead, SyncByteProgress } from '@/domain/sync/object-types';
import type { SyncObjectStore } from '@/sync/objects';
import { isWritePreconditionFailure, objectId, readS3Object, statS3Object, writeS3Object,
  type S3ObjectContext } from '@/platform/s3-store-common';
import { measureS3VaultBytes } from '@/platform/s3-vault-store';

function assetKey(context: S3ObjectContext, address: SyncObjectAddress): string {
  return context.base('vaults', objectId(address.vaultId, '同步库'), 'assets', `${objectId(address.objectId, '媒体')}.enc`);
}

function snapshotKey(context: S3ObjectContext, address: SyncObjectAddress): string {
  return context.base('vaults', objectId(address.vaultId, '同步库'), 'devices',
    objectId(address.objectId, '设备'), 'snapshot.enc');
}

function snapshotHead(input: { readonly object: { readonly Key?: string; readonly Size?: number; readonly ETag?: string };
  readonly root: string }): SyncSnapshotHead | null {
  const { object, root } = input;
  if (!object.Key || !object.Key.startsWith(`${root}/`)) throw new Error('S3 设备列表对象越出当前同步库');
  const match = /^([^/]+)\/snapshot\.enc$/.exec(object.Key.slice(root.length + 1));
  if (!match) return null;
  const deviceId = objectId(match[1]!, '设备');
  if (!object.ETag || !Number.isSafeInteger(object.Size)) throw new Error(`S3 设备快照缺少 ETag 或大小：${deviceId}`);
  return { deviceId, revision: object.ETag, ciphertextBytes: Number(object.Size) };
}

async function listSnapshots(context: S3ObjectContext, vaultId: string): Promise<readonly SyncSnapshotHead[]> {
  const root = context.base('vaults', objectId(vaultId, '同步库'), 'devices');
  const heads: SyncSnapshotHead[] = [];
  for await (const object of context.listObjects(`${root}/`)) {
    const head = snapshotHead({ object, root });
    if (head) heads.push(head);
  }
  return heads.toSorted((left, right) => left.deviceId.localeCompare(right.deviceId));
}

async function createAsset(context: S3ObjectContext, input: SyncObjectAddress & {
  readonly ciphertext: Uint8Array; readonly onProgress?: SyncByteProgress;
}) {
  if (input.ciphertext.length === 0) throw new Error('不能上传空的 S3 媒体对象');
  const key = assetKey(context, input);
  try {
    const revision = await writeS3Object({ context, key, body: input.ciphertext,
      condition: { IfNoneMatch: '*' }, label: '媒体',
      progress: (completed, total) => input.onProgress?.(completed, total ?? input.ciphertext.length) });
    return { created: true, revision };
  } catch (cause) {
    if (!isWritePreconditionFailure(cause)) throw cause;
    const existing = await statS3Object(context, key, '已有媒体');
    if (!existing) throw new Error('S3 媒体条件竞争后对象不存在');
    return { created: false, revision: existing.revision };
  }
}

async function readSnapshot(context: S3ObjectContext, input: Parameters<SyncObjectStore['readSnapshot']>[0]) {
  const object = await readS3Object({ context, key: snapshotKey(context, input), label: '设备快照', revision: input.revision,
    progress: (completed, total) => input.onProgress?.(completed, total ?? input.expectedCiphertextBytes) });
  if (!object) throw new Error('S3 设备快照不存在');
  if (object.revision !== input.revision) throw new Error('S3 设备快照版本已变化');
  return object;
}

export function createS3ObjectStore(context: S3ObjectContext): SyncObjectStore {
  return {
    listSnapshots: ({ vaultId }) => listSnapshots(context, vaultId),
    readSnapshot: (input) => readSnapshot(context, input),
    readAsset: (input) => readS3Object({ context, key: assetKey(context, input), label: '媒体',
      progress: (completed, total) => input.onProgress?.(completed, total ?? input.expectedCiphertextBytes) }),
    statAsset: ({ vaultId, objectId }) => statS3Object(context, assetKey(context, { vaultId, objectId }), '媒体'),
    measureVaultBytes: ({ vaultId, onObjectProgress }) => measureS3VaultBytes(context, vaultId, onObjectProgress),
    createAsset: (input) => createAsset(context, input),
    async publishSnapshot({ vaultId, objectId, expectedRevision, ciphertext }) {
      const revision = await writeS3Object({ context, key: snapshotKey(context, { vaultId, objectId }),
        body: ciphertext, condition: expectedRevision === null ? { IfNoneMatch: '*' } : { IfMatch: expectedRevision },
        label: '设备快照' });
      return { revision };
    },
  };
}
