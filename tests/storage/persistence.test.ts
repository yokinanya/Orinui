import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@/domain/id';
import { createDefaultSettings, type AppSettings } from '@/domain/settings';
import { createDataCommands } from '@/app/data-commands';
import { createDatabase, SETTINGS_ID, type OrinuiDatabase, type SettingsRow } from '@/storage/db';
import { listGroups } from '@/storage/groups';
import { ensureInitialized } from '@/storage/init';
import { createShortcut, listShortcuts } from '@/storage/shortcuts';
import { readSettings, updateSettings } from '@/storage/settings';

let db: OrinuiDatabase;
let name: string;

beforeEach(async () => {
  name = `test-${newId()}`;
  db = createDatabase(name);
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('ensureInitialized', () => {
  it('首次运行建立默认分组与默认设置', async () => {
    const state = await ensureInitialized(db);

    expect(state.defaultGroup.isDefault).toBe(true);
    expect(state.settings).toEqual(createDefaultSettings());
    expect(await db.settings.count()).toBe(1);
  });

  it('重复调用保持幂等', async () => {
    const first = await ensureInitialized(db);
    const second = await ensureInitialized(db);

    expect(second.defaultGroup.id).toBe(first.defaultGroup.id);
    expect(await db.groups.count()).toBe(1);
    expect(await db.settings.count()).toBe(1);
  });

  it('不会预置任何网站', async () => {
    await ensureInitialized(db);

    expect(await db.shortcuts.count()).toBe(0);
  });
});

describe('readSettings 与 updateSettings', () => {
  it('没有设置行时返回默认值而不写入', async () => {
    const settings = await readSettings(db);

    expect(settings).toEqual(createDefaultSettings());
    expect(await db.settings.count()).toBe(0);
  });

  it('更新只影响目标分区', async () => {
    await ensureInitialized(db);

    const updated = await updateSettings(db, (current) => ({
      ...current,
      clock: { ...current.clock, format: '24h' },
    }));

    expect(updated.clock.format).toBe('24h');
    expect(updated.search.defaultEngineId).toBe('google');
  });

  it('更新函数返回非法值时拒绝写入', async () => {
    await ensureInitialized(db);

    // 故意返回非法主题，验证写入前的校验会拦截它。
    const invalidTheme = { theme: 'neon' } as unknown as AppSettings['appearance'];
    await expect(
      updateSettings(db, (current) => ({ ...current, appearance: invalidTheme })),
    ).rejects.toThrowError(/主题设置不正确/);

    expect((await readSettings(db)).appearance.theme).toBe('system');
  });

  it('存储的设置行损坏时明确报错', async () => {
    // 故意写入非法值，模拟本地数据被外部破坏的情况。
    const broken = {
      id: SETTINGS_ID,
      ...createDefaultSettings(),
      clock: { format: 'x' },
    } as unknown as SettingsRow;
    await db.settings.put(broken);

    await expect(readSettings(db)).rejects.toThrowError(/时钟设置不正确/);
  });
});

describe('主页布局命令', () => {
  it('布局补丁保留同组其他选项，恢复默认布局不影响时钟和打开方式', async () => {
    await ensureInitialized(db);
    await updateSettings(db, (current) => ({ ...current,
      layout: { ...current.layout, pageWidth: 'compact', regionSpacing: 'relaxed', columns: 8, hidden: ['clock'] },
      clock: { ...current.clock, size: 'large', weekdayFormat: 'english-short' },
      search: { ...current.search, autoFocus: true, openTarget: 'new-tab' },
      shortcuts: { showNames: false, openTarget: 'new-tab' },
    }));
    const commands = createDataCommands({ db, activeGroupId: null,
      loadGroups: async () => [], loadShortcuts: async () => undefined,
      setActiveGroupId: () => undefined, setSettings: () => undefined });

    await commands.updateLayout({ pageWidth: 'wide' });
    expect((await readSettings(db)).layout).toMatchObject({ pageWidth: 'wide', regionSpacing: 'relaxed', columns: 8 });
    await commands.resetLayout();

    const settings = await readSettings(db);
    expect(settings.layout).toEqual(createDefaultSettings().layout);
    expect(settings.shortcuts).toEqual({ showNames: true, openTarget: 'new-tab' });
    expect(settings.clock).toMatchObject({ size: 'large', weekdayFormat: 'english-short' });
    expect(settings.search).toMatchObject({ autoFocus: true, openTarget: 'new-tab' });
  });
});

describe('持久化', () => {
  it('关闭并重新打开后数据仍在', async () => {
    const state = await ensureInitialized(db);
    await createShortcut(db, {
      groupId: state.defaultGroup.id,
      title: '文档',
      url: 'https://example.com/docs',
    });
    await updateSettings(db, (current) => ({ ...current, appearance: { ...current.appearance, theme: 'dark' } }));
    db.close();

    const reopened = createDatabase(name);
    await reopened.open();
    try {
      const groups = await listGroups(reopened);
      const shortcuts = await listShortcuts(reopened, groups[0]!.id);
      const settings = await readSettings(reopened);

      expect(groups.map((group) => group.name)).toEqual(['常用']);
      expect(shortcuts.map((shortcut) => shortcut.title)).toEqual(['文档']);
      expect(shortcuts[0]?.url).toBe('https://example.com/docs');
      expect(settings.appearance.theme).toBe('dark');
    } finally {
      reopened.close();
      await reopened.delete();
    }
  });
});
