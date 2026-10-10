import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultAppearance } from '@/domain/appearance';
import { newId } from '@/domain/id';
import { createDefaultSettings } from '@/domain/settings';
import { createDatabase, type OrinuiDatabase } from '@/storage/db';
import { readSettings } from '@/storage/settings';

/** 只包含版本 1 结构的数据库，用来写入旧数据。 */
class LegacyDatabase extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      groups: 'id, order, isDefault',
      shortcuts: 'id, groupId, order',
      settings: 'id',
    });
  }
}

const opened: OrinuiDatabase[] = [];

afterEach(async () => {
  for (const database of opened) {
    database.close();
    await database.delete();
  }
  opened.length = 0;
});

async function openCurrent(name: string): Promise<OrinuiDatabase> {
  const database = createDatabase(name);
  opened.push(database);
  await database.open();
  return database;
}

describe('schema 迁移', () => {
  it('版本 1 的设置行升级到版本 2 后补齐外观字段', async () => {
    const name = `migration-${newId()}`;

    const legacy = new LegacyDatabase(name);
    await legacy.open();
    const legacySettings = createDefaultSettings();
    await legacy.table('settings').put({
      id: 'app',
      ...legacySettings,
      // 版本 1 的外观只有主题
      appearance: { theme: 'dark' },
    });
    legacy.close();

    const upgraded = await openCurrent(name);
    const settings = await readSettings(upgraded);

    expect(settings.appearance.theme).toBe('dark');
    expect(settings.appearance.background).toEqual(createDefaultAppearance().background);
    expect(settings.appearance.dynamicColor).toEqual(createDefaultAppearance().dynamicColor);
  });

  it('升级保留分组与网站数据', async () => {
    const name = `migration-${newId()}`;

    const legacy = new LegacyDatabase(name);
    await legacy.open();
    await legacy.table('groups').put({ id: 'g1', name: '常用', colorRole: 'primary', order: 0, isDefault: true });
    await legacy.table('shortcuts').put({
      id: 's1',
      groupId: 'g1',
      title: '文档',
      url: 'https://example.com',
      icon: { kind: 'letter' },
      iconSourceUrl: null,
      order: 0,
    });
    legacy.close();

    const upgraded = await openCurrent(name);

    expect(await upgraded.groups.count()).toBe(1);
    expect((await upgraded.shortcuts.get('s1'))?.title).toBe('文档');
    expect(await upgraded.assets.count()).toBe(0);
  });
});
