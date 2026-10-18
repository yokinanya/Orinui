import type { SyncObjectContext } from '@/platform/sync-crypto-types';

export const SYNC_KEY_BYTES = 32;
export const SYNC_IV_BYTES = 12;
export const SYNC_TAG_BITS = 128;
export const SYNC_ALGORITHM = 'AES-GCM';
export const SYNC_ENCRYPTION_VERSION = 1;
export const SYNC_BITS_PER_BYTE = 8;
const RECOVERY_KEY_CHARACTERS = 43;
const BASE64_PADDING = '=';
const HEX_BYTE_CHARACTERS = 2;
const HEX_RADIX = 16;
const PACKET_MAGIC = new TextEncoder().encode('ORINUI01');
const HEADER_BYTES = PACKET_MAGIC.length + SYNC_IV_BYTES;
const TAG_BYTES = SYNC_TAG_BITS / SYNC_BITS_PER_BYTE;
export const SYNC_ENVELOPE_OVERHEAD_BYTES = HEADER_BYTES + TAG_BYTES;

export function encodeRecoveryKey(bytes: Uint8Array): string {
  const encoded = btoa(String.fromCharCode(...bytes));
  return encoded.replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function decodeRecoveryKey(value: string): Uint8Array<ArrayBuffer> {
  if (value.length !== RECOVERY_KEY_CHARACTERS || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('恢复密钥格式不正确');
  }
  const decoded = atob(value.replaceAll('-', '+').replaceAll('_', '/') + BASE64_PADDING);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.length !== SYNC_KEY_BYTES || encodeRecoveryKey(bytes) !== value) {
    throw new Error('恢复密钥格式不正确');
  }
  return bytes;
}

export function authenticationData(context: SyncObjectContext): Uint8Array<ArrayBuffer> {
  if (!context.vaultId.trim() || !context.objectId.trim()) throw new Error('同步对象身份不完整');
  if (context.kind !== 'snapshot' && context.kind !== 'asset') throw new Error('同步对象类别不正确');
  return new TextEncoder().encode(JSON.stringify({
    schemaVersion: SYNC_ENCRYPTION_VERSION, vaultId: context.vaultId, kind: context.kind, objectId: context.objectId,
  }));
}

export function packCiphertext(iv: Uint8Array, ciphertext: ArrayBuffer): Uint8Array {
  const packet = new Uint8Array(HEADER_BYTES + ciphertext.byteLength);
  packet.set(PACKET_MAGIC);
  packet.set(iv, PACKET_MAGIC.length);
  packet.set(new Uint8Array(ciphertext), HEADER_BYTES);
  return packet;
}

export function unpackCiphertext(packet: Uint8Array) {
  if (packet.length < HEADER_BYTES + TAG_BYTES) throw new Error('加密同步对象不完整');
  if (!PACKET_MAGIC.every((byte, index) => packet[index] === byte)) {
    throw new Error('不支持的加密同步格式');
  }
  return {
    iv: new Uint8Array(packet.slice(PACKET_MAGIC.length, HEADER_BYTES)),
    ciphertext: new Uint8Array(packet.slice(HEADER_BYTES)),
  };
}

export function digestHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_CHARACTERS, '0')).join('');
}
