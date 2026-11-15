import { liveQuery } from 'dexie';
import type { BookmarkPreferences } from '@/domain/bookmark-preferences';
import type { Database } from '@/storage/db';
import { readSettings } from '@/storage/settings';

/**
 * 只读观察既有 `settings` 行上的浏览器书签偏好。
 *
 * 边界（与 ARCHITECTURE「关闭偏好的跨页观察」一致）：
 * - 只读 `readSettings(db).bookmarks`；不写设置、不建表、不加墓碑或全局代次。
 * - 复用 Dexie liveQuery：同源其它 Dexie 连接提交后，本连接按提交广播重新查询。
 * - 读取或校验失败经 `error` 显式上报，不伪装成默认偏好。
 * - 返回的取消函数解除 liveQuery 订阅；调用方负责在页面卸载时调用。
 *
 * 本函数不承诺页面被冻结、崩溃或卸载后仍收到广播，也不承诺原生投递顺序；
 * 它只保证当前活跃页面看到已提交的偏好。
 */
export function observeBookmarkPreferences(
  db: Database,
  callbacks: {
    readonly next: (preferences: BookmarkPreferences) => void;
    readonly error: (cause: unknown) => void;
  },
): () => void {
  let stopped = false;
  const subscription = liveQuery(async () => (await readSettings(db)).bookmarks).subscribe({
    next(value) {
      if (!stopped) callbacks.next(value);
    },
    error(cause) {
      if (!stopped) callbacks.error(cause);
    },
  });
  return () => {
    if (stopped) return;
    stopped = true;
    subscription.unsubscribe();
  };
}
