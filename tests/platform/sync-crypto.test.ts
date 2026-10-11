import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSyncCrypto } from '@/platform/sync-crypto';

const cipher = createSyncCrypto(webcrypto as unknown as Crypto);
const context = { vaultId: 'vault', kind: 'snapshot' as const, objectId: 'device-a' };
const plaintext = new TextEncoder().encode('网站、照片和设置');

describe('native encrypted sync objects', () => {
  it('restores another device from the recovery key and keeps keys non-extractable', async () => {
    const created = await cipher.createKey();
    const restored = await cipher.importKey(created.recoveryKey);
    const ciphertext = await cipher.encrypt({ key: created.key, context, plaintext });
    expect(restored.extractable).toBe(false);
    await expect(webcrypto.subtle.exportKey('raw', restored)).rejects.toThrow();
    expect(await cipher.decrypt({ key: restored, context, ciphertext })).toEqual(plaintext);
  });

  it('uses a fresh IV instead of producing deterministic ciphertext', async () => {
    const { key } = await cipher.createKey();
    const first = await cipher.encrypt({ key, context, plaintext });
    const second = await cipher.encrypt({ key, context, plaintext });
    expect(first).not.toEqual(second);
    expect(await cipher.decrypt({ key, context, ciphertext: second })).toEqual(plaintext);
  });

  it('rejects a wrong recovery key, changed bytes and mismatched object identity', async () => {
    const { key } = await cipher.createKey();
    const wrong = await cipher.createKey();
    const ciphertext = await cipher.encrypt({ key, context, plaintext });
    await expect(cipher.decrypt({ key: wrong.key, context, ciphertext })).rejects.toThrow('密钥');
    await expect(cipher.decrypt({
      key, context: { ...context, kind: 'asset' }, ciphertext,
    })).rejects.toThrow('对象身份');
    const tampered = ciphertext.slice();
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    await expect(cipher.decrypt({ key, context, ciphertext: tampered })).rejects.toThrow('密文');
  });

  it('rejects truncated packets, unknown versions and malformed recovery encodings', async () => {
    const { key, recoveryKey } = await cipher.createKey();
    const ciphertext = await cipher.encrypt({ key, context, plaintext });
    await expect(cipher.decrypt({ key, context, ciphertext: ciphertext.slice(0, 10) })).rejects.toThrow('不完整');
    const future = ciphertext.slice();
    future[0] = 0;
    await expect(cipher.decrypt({ key, context, ciphertext: future })).rejects.toThrow('不支持');
    await expect(cipher.importKey(recoveryKey + '=')).rejects.toThrow('格式');
    await expect(cipher.importKey('password')).rejects.toThrow('格式');
  });
});
