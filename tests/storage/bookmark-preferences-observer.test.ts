import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultSettings } from '@/domain/settings';
import type { BookmarkPreferences } from '@/domain/bookmark-preferences';
import { createDatabase, SETTINGS_ID, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { updateSettings } from '@/storage/settings';
import { observeBookmarkPreferences } from '@/storage/bookmark-preferences-observer';

// 用真实 Dexie + fake-indexeddb 验证跨连接可见性，而不是断言源码字符串。
// 这两条连接模拟两个同源页面各自持有的 Dexie 实例。

const databases: Database[] = [];

async function openDatabase(): Promise<{ reader: Database; writer: Database }> {
  const name = `bookmark-observer-${crypto.randomUUID()}`;
  const reader = createDatabase(name);
  const writer = createDatabase(name);
  databases.push(reader, writer);
  await reader.open();
  await writer.open();
  return { reader, writer };
}

async function waitFor(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`等待超时：${label}`);
}

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
    try {
      await database.delete();
    } catch {
      // 同名数据库已由另一连接删除时无关紧要；清理失败不掩盖断言结果。
    }
  }
});

describe('observeBookmarkPreferences', () => {
  it('另一 Dexie 连接提交 bookmarks 后，本连接收到三个开关与隐藏规则', async () => {
    const { reader, writer } = await openDatabase();
    await ensureInitialized(writer);
    const seen: BookmarkPreferences[] = [];
    const errors: unknown[] = [];
    const unsubscribe = observeBookmarkPreferences(reader, {
      next: (preferences) => seen.push(preferences),
      error: (cause) => errors.push(cause),
    });
    try {
      await waitFor(() => seen.length > 0, '初始偏好');
      expect(seen[0]).toEqual(createDefaultSettings().bookmarks);

      await updateSettings(writer, (current) => ({
        ...current,
        bookmarks: {
          enabled: true,
          mode: 'folder',
          showInSearch: false,
          hiddenRules: [{
            ruleId: 'rule-1', targetId: 'f-work', path: ['书签栏', '工作'],
            kind: 'folder', hidden: true, updatedAt: 1_700_000_000_000,
          }],
        },
      }));

      await waitFor(
        () => seen.some((preferences) => preferences.enabled && preferences.mode === 'folder'),
        '跨连接偏好变化',
      );
      expect(seen.at(-1)).toEqual({
        enabled: true,
        mode: 'folder',
        showInSearch: false,
        hiddenRules: [{
          ruleId: 'rule-1', targetId: 'f-work', path: ['书签栏', '工作'],
          kind: 'folder', hidden: true, updatedAt: 1_700_000_000_000,
        }],
      });
      expect(errors).toEqual([]);
    } finally {
      unsubscribe();
    }
  });

  it('只读：数据库没有设置行时也只投递默认值，不创建行', async () => {
    const { reader, writer } = await openDatabase();
    const seen: BookmarkPreferences[] = [];
    const unsubscribe = observeBookmarkPreferences(reader, {
      next: (preferences) => seen.push(preferences),
      error: () => {},
    });
    try {
      await waitFor(() => seen.length > 0, '默认偏好');
      expect(seen[0]).toEqual(createDefaultSettings().bookmarks);
      expect(await writer.settings.count()).toBe(0);
      expect(await reader.settings.count()).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it('设置行损坏时投递 error，不伪装成默认值', async () => {
    const { reader, writer } = await openDatabase();
    await ensureInitialized(writer);
    const errors: unknown[] = [];
    const seen: BookmarkPreferences[] = [];
    const unsubscribe = observeBookmarkPreferences(reader, {
      next: (preferences) => seen.push(preferences),
      error: (cause) => errors.push(cause),
    });
    try {
      await waitFor(() => seen.length > 0, '初始偏好');
      // 绕过 updateSettings 的校验，模拟磁盘上的损坏行（旧版本/外部写入）。
      await writer.settings.put({
        id: SETTINGS_ID,
        ...createDefaultSettings(),
        bookmarks: { enabled: 'yes', mode: 'region', showInSearch: true, hiddenRules: [] },
      } as never);
      await waitFor(() => errors.length > 0, '校验错误');
      expect(errors[0]).toBeInstanceOf(Error);
      // 领域校验原样上抛：不吞掉、不改写成默认值。
      expect((errors[0] as Error).message).toContain('浏览器书签');
      // 错误之后不得把同一个损坏值当成合法偏好发布。
      expect(seen.every((preferences) => preferences.enabled === false)).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('本连接自己提交也会经 liveQuery 回声投递，不依赖其它页面', async () => {
    const { reader, writer } = await openDatabase();
    await ensureInitialized(writer);
    const seen: BookmarkPreferences[] = [];
    const unsubscribe = observeBookmarkPreferences(reader, {
      next: (preferences) => seen.push(preferences),
      error: () => {},
    });
    try {
      await waitFor(() => seen.length > 0, '初始偏好');
      // 同一个数据库连接提交：本页写入也必须被观察器看到，否则启用意图无法回流。
      await updateSettings(reader, (current) => ({ ...current, bookmarks: { ...current.bookmarks, enabled: true } }));
      await waitFor(() => seen.some((preferences) => preferences.enabled), '本连接回声');
      expect(seen.at(-1)?.enabled).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('unsubscribe 之后另一连接的提交不再回调', async () => {
    const { reader, writer } = await openDatabase();
    await ensureInitialized(writer);
    const seen: BookmarkPreferences[] = [];
    const unsubscribe = observeBookmarkPreferences(reader, {
      next: (preferences) => seen.push(preferences),
      error: () => {},
    });
    await waitFor(() => seen.length > 0, '初始偏好');
    unsubscribe();
    const countAtUnsubscribe = seen.length;

    await updateSettings(writer, (current) => ({
      ...current,
      bookmarks: { ...current.bookmarks, enabled: true, mode: 'folder' },
    }));
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(seen).toHaveLength(countAtUnsubscribe);
  });
});
