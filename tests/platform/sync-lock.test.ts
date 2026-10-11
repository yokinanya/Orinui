import { describe, expect, it, vi } from 'vitest';

import { createBrowserSyncLock } from '@/platform/sync-lock';

describe('createBrowserSyncLock', () => {
  it('请求指定 scope 的原生 exclusive 锁并返回操作结果', async () => {
    const request = vi.fn(async (_scope: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<string>) =>
      callback(null));
    const lock = createBrowserSyncLock({ request } as unknown as Pick<LockManager, 'request'>);
    const operation = vi.fn(async () => '完成');

    await expect(lock.runExclusive('orinui-sync-vault-1', operation)).resolves.toBe('完成');
    expect(request).toHaveBeenCalledWith('orinui-sync-vault-1', { mode: 'exclusive' }, operation);
    expect(operation).toHaveBeenCalledOnce();
  });

  it('保留操作抛出的原始错误并交由原生管理器释放锁', async () => {
    const failure = new Error('同步操作失败');
    const request = vi.fn(async (_scope: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<never>) =>
      callback(null));
    const lock = createBrowserSyncLock({ request } as unknown as Pick<LockManager, 'request'>);

    await expect(lock.runExclusive('orinui-sync-vault-1', async () => { throw failure; })).rejects.toBe(failure);
  });

  it('管理器不可用时明确报错', () => {
    expect(() => createBrowserSyncLock(undefined as never)).toThrowError(/Web Locks/);
  });
});
