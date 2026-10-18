import type { SyncAssetReceipt, SyncObjectRead, SyncPublishReceipt, SyncSnapshotHead } from '@/domain/sync/object-types';

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}格式不正确`);
  return value as Record<string, unknown>;
}

export function validateObjectIdentity(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value || CONTROL_CHARACTERS.test(value)) {
    throw new Error(`${label}需要不含控制字符的非空标识`);
  }
  return value;
}

function integerBytes(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('远端对象大小格式不正确');
  return Number(value);
}

export function parseSnapshotHeads(value: unknown): readonly SyncSnapshotHead[] {
  if (!Array.isArray(value)) throw new Error('设备快照列表格式不正确');
  const devices = new Set<string>();
  return value.map((item) => {
    const raw = record(item, '设备快照');
    const deviceId = validateObjectIdentity(raw.deviceId, '设备');
    if (devices.has(deviceId)) throw new Error(`设备快照重复：${deviceId}`);
    devices.add(deviceId);
    const ciphertextBytes = raw.ciphertextBytes === undefined ? undefined : integerBytes(raw.ciphertextBytes);
    return { deviceId, revision: validateObjectIdentity(raw.revision, '对象版本'),
      ...(ciphertextBytes === undefined ? {} : { ciphertextBytes }) };
  }).toSorted((left, right) => left.deviceId < right.deviceId ? -1 : Number(left.deviceId !== right.deviceId));
}

export function parseObjectRead(value: unknown): SyncObjectRead {
  const raw = record(value, '加密对象');
  if (!(raw.ciphertext instanceof Uint8Array) || raw.ciphertext.length === 0) throw new Error('加密对象缺少密文字节');
  return { revision: validateObjectIdentity(raw.revision, '对象版本'), ciphertext: new Uint8Array(raw.ciphertext) };
}

export function parsePublishReceipt(value: unknown): SyncPublishReceipt {
  const raw = record(value, '发布回执');
  return { revision: validateObjectIdentity(raw.revision, '发布版本') };
}

export function parseAssetReceipt(value: unknown): SyncAssetReceipt {
  const raw = record(value, '媒体回执');
  if (typeof raw.created !== 'boolean') throw new Error('媒体回执缺少实际创建状态');
  return { created: raw.created, revision: validateObjectIdentity(raw.revision, '媒体版本') };
}
