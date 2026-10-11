import type { SyncLock } from '@/sync/ports';

export function createBrowserSyncLock(manager: Pick<LockManager, 'request'>): SyncLock {
  if (typeof manager?.request !== 'function') {
    throw new Error('当前浏览器未提供 Web Locks，同步独占锁不可用');
  }

  return {
    runExclusive<T>(scope: string, operation: () => Promise<T>): Promise<T> {
      return Promise.resolve(manager.request(scope, { mode: 'exclusive' }, operation));
    },
  };
}
