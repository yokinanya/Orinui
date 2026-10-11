import { expect, it } from 'vitest';
import { parseAssetReceipt, parseObjectRead, parsePublishReceipt, parseSnapshotHeads } from '@/domain/sync/object-validation';

it('rejects duplicate or unsafe device identities at the object-store boundary', () => {
  expect(() => parseSnapshotHeads([{ deviceId: 'a', revision: 'v1' }, { deviceId: 'a', revision: 'v2' }])).toThrow('重复');
  expect(() => parseSnapshotHeads([{ deviceId: 'a\nb', revision: 'v1' }])).toThrow('控制字符');
  expect(() => parseSnapshotHeads([{ deviceId: 'a', revision: ' ' }])).toThrow('非空');
  expect(() => parseSnapshotHeads({ deviceId: 'a' })).toThrow('列表格式');
});

it('normalizes object heads without mutating the provider response', () => {
  const heads = [{ deviceId: 'b', revision: 'v2' }, { deviceId: 'a', revision: 'v1' }];
  expect(parseSnapshotHeads(heads)).toEqual([heads[1], heads[0]]);
  expect(heads.map(({ deviceId }) => deviceId)).toEqual(['b', 'a']);
});

it('copies received bytes and rejects invalid encrypted object responses', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const received = parseObjectRead({ revision: 'v1', ciphertext: bytes });
  bytes[0] = 9;
  expect(received.ciphertext[0]).toBe(1);
  expect(() => parseObjectRead({ revision: 'v1', ciphertext: [] })).toThrow('密文字节');
  expect(() => parseObjectRead({ revision: 'v1', ciphertext: new Uint8Array() })).toThrow('密文字节');
});

it('requires an explicit creation result and a nonempty confirmed publication revision', () => {
  expect(parseAssetReceipt({ created: false, revision: 'v1' })).toEqual({ created: false, revision: 'v1' });
  expect(() => parseAssetReceipt({ created: 'ok', revision: 'v1' })).toThrow('实际创建状态');
  expect(() => parsePublishReceipt({ revision: '' })).toThrow('发布版本');
  expect(() => parsePublishReceipt(undefined)).toThrow('回执格式');
});
