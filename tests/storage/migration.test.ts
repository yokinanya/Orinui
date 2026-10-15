import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';

import { createDefaultAppearance } from '@/domain/appearance';
import { newId } from '@/domain/id';
import { createDefaultSettings } from '@/domain/settings';
import { createDatabase, type OrinuiDatabase } from '@/storage/db';
import { readSettings } from '@/storage/settings';
import type { SyncRecordRow } from '@/storage/sync/types';

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

class PixelSizeDatabase extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(3).stores({
      groups: 'id, order, isDefault', shortcuts: 'id, groupId, order', settings: 'id', assets: 'id, kind',
      sync_state: 'id', sync_records: 'id, kind, entityId', sync_keys: 'id',
    });
  }
}

class VersionFourDatabase extends Dexie {
  constructor(name: string) {
    super(name);
    this.version(4).stores({
      groups: 'id, order, isDefault', shortcuts: 'id, groupId, order', settings: 'id', assets: 'id, kind',
      sync_state: 'id', sync_records: 'id, kind, entityId', sync_keys: 'id',
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

async function upgradeLegacyAppearance(name: string) {
  const legacy = new LegacyDatabase(name);
  await legacy.open();
  const legacySettings = createDefaultSettings();
  await legacy.table('settings').put({ id: 'app', ...legacySettings, appearance: { theme: 'dark' } });
  legacy.close();
  return readSettings(await openCurrent(name));
}

describe('schema 迁移：早期版本', () => {
  it('版本 1 的设置行升级到版本 2 后补齐外观字段', async () => {
    const settings = await upgradeLegacyAppearance(`migration-${newId()}`);

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
      id: 's1', groupId: 'g1', title: '文档', url: 'https://example.com',
      icon: { kind: 'letter' }, iconSourceUrl: null, order: 0,
    });
    legacy.close();
    const upgraded = await openCurrent(name);
    expect(await upgraded.groups.count()).toBe(1);
    expect((await upgraded.shortcuts.get('s1'))?.title).toBe('文档');
    expect(await upgraded.assets.count()).toBe(0);
  });
});

describe('schema 迁移：图标占比', () => {
  it('将旧像素尺寸迁移为占比，并同步迁移本地快照寄存器', async () => {
    const name = `migration-${newId()}`;
    const legacy = new PixelSizeDatabase(name);
    await legacy.open();
    await legacy.table('shortcuts').put({ id: 's1', groupId: 'g1', title: '旧图标', url: 'https://example.com',
      icon: { kind: 'asset', assetId: 'a1', size: 32 }, iconSourceUrl: null, order: 0 });
    await legacy.table('sync_records').put({ id: 'shortcut:s1', kind: 'shortcut', entityId: 's1', value: {
      id: 's1', title: { value: '旧图标', clock: 1, deviceId: 'd1' },
      url: { value: 'https://example.com', clock: 1, deviceId: 'd1' },
      placement: { value: { groupId: 'g1', order: 0 }, clock: 1, deviceId: 'd1' },
      icon: { value: { kind: 'asset', assetId: 'a1', size: 32 }, clock: 1, deviceId: 'd1' },
    } });
    legacy.close();
    const upgraded = await openCurrent(name);
    expect((await upgraded.shortcuts.get('s1'))?.icon).toEqual({ kind: 'asset', assetId: 'a1', occupancy: 67 });
    const syncRecord = await upgraded.sync_records.get('shortcut:s1');
    const register = syncRecord?.kind === 'shortcut'
      ? (syncRecord as Extract<SyncRecordRow, { kind: 'shortcut' }>).value.icon : null;
    expect(register?.value).toEqual({ kind: 'asset', assetId: 'a1', occupancy: 67 });
  });
});

describe('schema 迁移：个性化设置', () => {
  it('迁移旧个性化设置并保留同步逻辑版本', async () => {
    const name = `migration-${newId()}`;
    const legacy = new VersionFourDatabase(name);
    await legacy.open();
    const defaults = createDefaultSettings();
    await legacy.table('settings').put({ id: 'app', appearance: defaults.appearance,
      search: { defaultEngineId: 'google', customEngines: [] },
      layout: { order: ['shortcuts', 'clock', 'search'], hidden: ['search'] }, clock: { format: '24h' } });
    await legacy.table('sync_records').put({ id: 'settings:app', kind: 'settings', entityId: 'app', value: {
      appearance: { value: defaults.appearance, clock: 3, deviceId: 'device-1' },
      defaultEngineId: { value: 'google', clock: 4, deviceId: 'device-1' },
      layout: { value: { order: ['shortcuts', 'clock', 'search'], hidden: ['search'] }, clock: 5, deviceId: 'device-1' },
      clock: { value: { format: '24h' }, clock: 6, deviceId: 'device-1' }, customEngines: [],
    } });
    await legacy.table('sync_state').put({ id: 'app', vaultId: 'vault-1', deviceId: 'device-1',
      clock: 6, generation: 1, defaultGroupId: { value: 'g1', clock: 1, deviceId: 'device-1' }, suspended: false });
    legacy.close();
    const upgraded = await openCurrent(name);
    const settings = await readSettings(upgraded);
    expect(settings).toMatchObject({ clock: { format: '24h', size: 'standard' },
      layout: { order: ['shortcuts', 'clock', 'search'], hidden: ['search'], columns: 6 },
      shortcuts: { showNames: true, openTarget: 'current-tab' } });
    const record = await upgraded.sync_records.get('settings:app');
    expect(record?.kind).toBe('settings');
    if (record?.kind !== 'settings') throw new Error('旧同步设置记录未迁移');
    expect(record.value.layout.clock).toBe(5);
    expect(record.value.clock.clock).toBe(6);
    expect(record.value.searchPreferences.clock).toBe(0);
    expect(record.value.shortcutPreferences.clock).toBe(0);
    expect((await upgraded.sync_state.get('app'))?.suspended).toBe(false);
  });

  it('迁移时拒绝损坏的旧布局设置', async () => {
    const name = `migration-${newId()}`;
    const legacy = new VersionFourDatabase(name);
    await legacy.open();
    const defaults = createDefaultSettings();
    await legacy.table('settings').put({ id: 'app', appearance: defaults.appearance,
      search: { defaultEngineId: 'google', customEngines: [] },
      layout: { order: ['clock'], hidden: [] }, clock: { format: '24h' } });
    legacy.close();
    await expect(openCurrent(name)).rejects.toThrow();
  });
});
