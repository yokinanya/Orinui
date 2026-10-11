import {
  authenticationData, decodeRecoveryKey, digestHex, encodeRecoveryKey, packCiphertext,
  SYNC_ALGORITHM, SYNC_BITS_PER_BYTE, SYNC_IV_BYTES, SYNC_KEY_BYTES, SYNC_TAG_BITS, unpackCiphertext,
} from '@/platform/sync-crypto-format';
import type { SyncCrypto } from '@/platform/sync-crypto-types';

export type { SyncCrypto, SyncKeyMaterial, SyncObjectContext } from '@/platform/sync-crypto-types';
type CryptoRuntime = Pick<Crypto, 'getRandomValues' | 'subtle'>;
const AES_KEY_BITS = SYNC_KEY_BYTES * SYNC_BITS_PER_BYTE;

function assertKey(key: CryptoKey): void {
  const algorithm = key.algorithm as AesKeyAlgorithm;
  if (key.type !== 'secret' || key.extractable || algorithm.name !== SYNC_ALGORITHM
    || algorithm.length !== AES_KEY_BITS || !key.usages.includes('encrypt') || !key.usages.includes('decrypt')) {
    throw new Error('需要本机不可导出的 AES-256-GCM 同步密钥');
  }
}

function importSecret(runtime: CryptoRuntime, bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return runtime.subtle.importKey('raw', bytes, SYNC_ALGORITHM, false, ['encrypt', 'decrypt']);
}

async function decryptObject(runtime: CryptoRuntime, input: Parameters<SyncCrypto['decrypt']>[0]) {
  assertKey(input.key);
  const packet = unpackCiphertext(input.ciphertext);
  const additionalData = authenticationData(input.context);
  try {
    const bytes = await runtime.subtle.decrypt({
      name: SYNC_ALGORITHM, iv: packet.iv, tagLength: SYNC_TAG_BITS, additionalData,
    }, input.key, packet.ciphertext);
    return new Uint8Array(bytes);
  } catch (cause) {
    throw new Error('同步密钥不正确、对象身份不匹配或密文已损坏', { cause });
  }
}

/** Runtime injection also allows tests to exercise the native Web Crypto implementation. */
export function createSyncCrypto(runtime: CryptoRuntime): SyncCrypto {
  return {
    async createKey() {
      const bytes = runtime.getRandomValues(new Uint8Array(SYNC_KEY_BYTES));
      return { recoveryKey: encodeRecoveryKey(bytes), key: await importSecret(runtime, bytes) };
    },
    async importKey(recoveryKey) {
      return importSecret(runtime, decodeRecoveryKey(recoveryKey));
    },
    async encrypt(input) {
      assertKey(input.key);
      const iv = runtime.getRandomValues(new Uint8Array(SYNC_IV_BYTES));
      const bytes = await runtime.subtle.encrypt({
        name: SYNC_ALGORITHM, iv, tagLength: SYNC_TAG_BITS,
        additionalData: authenticationData(input.context),
      }, input.key, new Uint8Array(input.plaintext));
      return packCiphertext(iv, bytes);
    },
    decrypt: (input) => decryptObject(runtime, input),
    async hash(bytes) {
      return digestHex(await runtime.subtle.digest('SHA-256', new Uint8Array(bytes)));
    },
  };
}
