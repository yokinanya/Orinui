import type { SyncObjectProgress } from '@/domain/sync/object-types';
import { isWritePreconditionFailure, objectId, parseS3Descriptor, readS3Object, S3_DELETE_MAX_KEYS,
  S3_DESCRIPTOR_VERSION, statS3Object, stringifyS3Descriptor, writeS3Object, deleteS3Keys, type S3ObjectContext,
  type S3VaultDescriptor } from '@/platform/s3-store-common';

const CHECK_BYTES = new TextEncoder().encode('Orinui S3 atomic condition check');

function vaultPrefix(context: S3ObjectContext, vaultId: string): string {
  return `${context.base('vaults', objectId(vaultId, '同步库'))}/`;
}

function descriptorKey(context: S3ObjectContext): string { return context.base('vault.json'); }

export async function readS3Vault(context: S3ObjectContext): Promise<S3VaultDescriptor | null> {
  const key = descriptorKey(context);
  const metadata = await statS3Object(context, key, '同步库描述');
  if (!metadata) return null;
  const object = await readS3Object({ context, key, label: '同步库描述', revision: metadata.revision });
  if (!object || object.revision !== metadata.revision) throw new Error('S3 同步库描述在读取期间发生变化');
  const parsed = parseS3Descriptor(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(object.ciphertext)));
  return { ...parsed, revision: object.revision };
}

export async function createS3Vault(context: S3ObjectContext,
  input: { readonly vaultId: string; readonly ciphertext: Uint8Array }): Promise<void> {
  const body = new TextEncoder().encode(stringifyS3Descriptor(input));
  await writeS3Object({ context, key: descriptorKey(context), body,
    condition: { IfNoneMatch: '*' }, label: '同步库描述' });
  const created = await readS3Vault(context);
  if (!created || created.vaultId !== input.vaultId || !equalBytes(created.ciphertext, input.ciphertext)) {
    throw new Error('S3 同步库创建结果与本机内容不一致');
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

async function verifyCreateCondition(context: S3ObjectContext, key: string): Promise<string> {
  const revision = await writeS3Object({ context, key, body: CHECK_BYTES, condition: { IfNoneMatch: '*' }, label: '条件探测' });
  let rejected = false;
  try { await writeS3Object({ context, key, body: new Uint8Array([...CHECK_BYTES, 0]), condition: { IfNoneMatch: '*' }, label: '重复创建探测' }); }
  catch (cause) { if (isWritePreconditionFailure(cause)) rejected = true; else throw cause; }
  if (!rejected) throw new Error('S3 服务未拒绝 If-None-Match 重复创建');
  const head = await statS3Object(context, key, '条件探测对象');
  if (!head || head.revision !== revision || head.ciphertextBytes !== CHECK_BYTES.length) {
    throw new Error('S3 If-None-Match 条件没有保留原对象');
  }
  return revision;
}

async function verifyMatchCondition(context: S3ObjectContext, key: string, revision: string): Promise<void> {
  let rejected = false;
  try { await writeS3Object({ context, key, body: CHECK_BYTES, condition: { IfMatch: `${revision}-wrong` }, label: '错误版本探测' }); }
  catch (cause) { if (isWritePreconditionFailure(cause)) rejected = true; else throw cause; }
  if (!rejected) throw new Error('S3 服务未拒绝错误的 If-Match 条件写入');
  const nextBody = new Uint8Array([...CHECK_BYTES, 0]);
  const nextRevision = await writeS3Object({ context, key, body: nextBody, condition: { IfMatch: revision }, label: '正确版本探测' });
  const updated = await readS3Object({ context, key, label: '条件探测对象', revision: nextRevision });
  if (!updated || !equalBytes(updated.ciphertext, nextBody)) throw new Error('S3 If-Match 条件更新未保存预期对象');
}

export async function verifyS3Conditions(context: S3ObjectContext,
  input: { readonly vaultId: string; readonly deviceId: string }): Promise<void> {
  const key = context.base('vaults', objectId(input.vaultId, '同步库'),
    `probe-${objectId(input.deviceId, '设备')}-${crypto.randomUUID()}.enc`);
  try {
    const revision = await verifyCreateCondition(context, key);
    await verifyMatchCondition(context, key, revision);
  } finally { await deleteS3Keys(context, [key]); }
}

async function deletePrefix(context: S3ObjectContext, prefix: string): Promise<void> {
  const batch: string[] = [];
  for await (const object of context.listObjects(prefix)) {
    if (!object.Key) throw new Error('S3 删除列表包含空对象键');
    batch.push(object.Key);
    if (batch.length === S3_DELETE_MAX_KEYS) { await deleteS3Keys(context, batch); batch.length = 0; }
  }
  await deleteS3Keys(context, batch);
}

async function assertPrefixEmpty(context: S3ObjectContext, prefix: string, message: string): Promise<void> {
  for await (const object of context.listObjects(prefix)) if (object.Key) throw new Error(message);
}

async function removeVaultDescription(context: S3ObjectContext, vaultId: string, expectedRevision: string): Promise<void> {
  const descriptor = await readS3Vault(context);
  if (!descriptor) return;
  if (descriptor.vaultId !== vaultId || descriptor.revision !== expectedRevision) {
    throw new Error('S3 同步库描述在删除期间发生变化；对象已部分清理，请停止其他设备后重新检查');
  }
  await deleteS3Keys(context, [descriptorKey(context)]);
  if (await readS3Vault(context)) throw new Error('S3 同步库描述删除后仍存在');
}

export async function deleteS3Vault(context: S3ObjectContext,
  input: { readonly vaultId: string; readonly descriptorRevision: string }): Promise<void> {
  const vaultId = objectId(input.vaultId, '同步库');
  const current = await readS3Vault(context);
  if (!current || current.vaultId !== vaultId || current.revision !== input.descriptorRevision) {
    throw new Error('S3 同步库身份或描述版本已变化，拒绝删除');
  }
  const prefix = vaultPrefix(context, vaultId);
  await deletePrefix(context, prefix);
  await assertPrefixEmpty(context, prefix, `S3 同步库删除后仍有对象：${vaultId}`);
  await removeVaultDescription(context, vaultId, input.descriptorRevision);
  await assertPrefixEmpty(context, prefix, 'S3 同步库删除期间有对象重新写入，请停止其他设备后重试');
}

export async function measureS3VaultBytes(context: S3ObjectContext, vaultId: string,
  onProgress?: SyncObjectProgress): Promise<number> {
  const prefix = vaultPrefix(context, vaultId);
  let total = 0;
  let count = 0;
  for await (const object of context.listObjects(prefix)) {
    if (!Number.isSafeInteger(object.Size) || Number(object.Size) < 0) throw new Error('S3 远端对象缺少准确大小');
    total += Number(object.Size); count += 1; onProgress?.(count);
    if (!Number.isSafeInteger(total)) throw new Error('S3 远端库总大小超出可计量范围');
  }
  const descriptor = await statS3Object(context, descriptorKey(context), '同步库描述');
  if (descriptor) { total += descriptor.ciphertextBytes ?? 0; onProgress?.(count + 1); }
  if (!Number.isSafeInteger(total)) throw new Error('S3 远端库总大小超出可计量范围');
  return total;
}

export function createS3VaultStore(context: S3ObjectContext) {
  return {
    readVault: () => readS3Vault(context),
    createVault: (input: { readonly vaultId: string; readonly ciphertext: Uint8Array }) => createS3Vault(context, input),
    verifyConditions: (input: { readonly vaultId: string; readonly deviceId: string }) => verifyS3Conditions(context, input),
    listVaultBytes: (vaultId: string, onObjectProgress?: SyncObjectProgress) => measureS3VaultBytes(context, vaultId, onObjectProgress),
    deleteVault: (vaultId: string, expectedDescriptorRevision: string) =>
      deleteS3Vault(context, { vaultId, descriptorRevision: expectedDescriptorRevision }),
  };
}
