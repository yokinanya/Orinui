import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { createDefaultSettings } from '@/domain/settings';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) { database.close(); await database.delete(); }
});

it('opens a fresh schema 13 database without legacy tables or content', async () => {
  const database = createDatabase(crypto.randomUUID());
  databases.push(database);
  await database.open();
  expect(database.verno).toBe(13);
  expect(database.tables.map(({ name }) => name)).not.toContain('groups');
  expect(await database.folders.count()).toBe(0);
  expect(await database.shortcuts.count()).toBe(0);
});

it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('rejects legacy schema %s without changing any persisted data', async (version) => {
  const name = crypto.randomUUID();
  const legacy = new Dexie(name);
  const stores = { groups: 'id, order, isDefault', shortcuts: 'id, groupId, order', settings: 'id',
    ...(version >= 2 ? { assets: 'id, kind' } : {}),
    ...(version >= 3 ? { sync_state: 'id', sync_records: 'id, kind, entityId', sync_keys: 'id' } : {}) };
  legacy.version(version).stores(stores);
  await legacy.open();
  await legacy.table('groups').put({ id: 'g1', name: '工作', order: 0, isDefault: true });
  await legacy.table('shortcuts').put({ id: 's1', groupId: 'g1', title: '文档', order: 0 });
  await legacy.table('settings').put({ id: 'app', ...createDefaultSettings() });
  if (version >= 3) {
    await legacy.table('sync_state').put({ id: 'app', vaultId: 'vault', suspended: false });
    await legacy.table('sync_records').put({ id: 'group:g1', kind: 'group', entityId: 'g1' });
    await legacy.table('sync_keys').put({ id: 'vault', key: { retained: true } });
  }
  const before = await Promise.all(legacy.tables.map((table) => table.toArray()));
  legacy.close();
  const current: Database = createDatabase(name);
  await expect(current.open()).rejects.toThrow(/旧分组安装.*备份.*重新安装.*未被清除/);
  current.close();
  await legacy.open();
  databases.push(legacy);
  expect(legacy.verno).toBe(version);
  expect(await Promise.all(legacy.tables.map((table) => table.toArray()))).toEqual(before);
});

const FOLDER_SCHEMA_STORES = { folders: 'id, order', shortcuts: 'id, folderId, order', settings: 'id',
  assets: 'id, kind', sync_state: 'id', sync_records: 'id, kind, entityId', sync_keys: 'id' };

async function createVersion11Database(name: string, invalidSettings = false): Promise<Dexie> {
  const legacy = new Dexie(name);
  legacy.version(11).stores(FOLDER_SCHEMA_STORES);
  await legacy.open();
  const defaults = createDefaultSettings();
  const { customization: _customization, ...oldSearch } = defaults.search;
  const settings = { ...defaults, search: oldSearch,
    ...(invalidSettings ? { clock: { ...defaults.clock, size: 'invalid' } } : {}) };
  await legacy.table('settings').put({ id: 'app', ...settings });
  await legacy.table('sync_state').put({ id: 'app', vaultId: 'vault-1', deviceId: 'device-1',
    clock: 17, generation: 9, suspended: false, hasAcceptedSnapshot: true });
  await legacy.table('sync_records').put({ id: 'settings:app', kind: 'settings', entityId: 'app', value: {
    appearance: { value: defaults.appearance, clock: 2, deviceId: 'device-1' },
    defaultEngineId: { value: 'google', clock: 3, deviceId: 'device-1' },
    layout: { value: defaults.layout, clock: 4, deviceId: 'device-1' },
    clock: { value: defaults.clock, clock: 5, deviceId: 'device-1' },
    searchPreferences: { value: { width: 'standard', autoFocus: false, openTarget: 'current-tab' }, clock: 6, deviceId: 'device-1' },
    shortcutPreferences: { value: defaults.shortcuts, clock: 7, deviceId: 'device-1' }, customEngines: [],
  } });
  await legacy.table('sync_keys').put({ id: 'vault-1', key: { retained: 'key' } });
  return legacy;
}

it('migrates version 11 settings while preserving sync identity, clocks, and keys', async () => {
  const name = crypto.randomUUID();
  const legacy = await createVersion11Database(name);
  const originalState = await legacy.table('sync_state').get('app');
  const originalKey = await legacy.table('sync_keys').get('vault-1');
  legacy.close();
  const current = createDatabase(name);
  databases.push(current);
  await current.open();
  expect(current.verno).toBe(13);
  expect((await current.settings.get('app'))?.search.customization.corner).toBe('standard');
  const migratedRecord = await current.sync_records.get('settings:app');
  if (migratedRecord?.kind !== 'settings') throw new Error('迁移后同步设置记录缺失');
  expect(migratedRecord.value.searchCustomization).toEqual({ value: createDefaultSettings().search.customization,
    clock: 0, deviceId: 'device-1' });
  expect(await current.sync_state.get('app')).toEqual(originalState);
  expect(await current.sync_keys.get('vault-1')).toEqual(originalKey);
});

it('migrates schema 12 built-in engine settings without changing sync clocks or identity', async () => {
  const name = crypto.randomUUID();
  const legacy = new Dexie(name);
  legacy.version(12).stores(FOLDER_SCHEMA_STORES);
  await legacy.open();
  const defaults = createDefaultSettings();
  const { engineOverrides: _engineOverrides, ...oldCustomization } = defaults.search.customization;
  const customization = { ...oldCustomization, corner: 'pill' as const, engineKeywords: { google: 'web' } };
  await legacy.table('settings').put({ id: 'app', ...defaults,
    search: { ...defaults.search, customization } });
  const state = { id: 'app', vaultId: 'vault-2', deviceId: 'device-2', clock: 27, generation: 11,
    suspended: false, hasAcceptedSnapshot: true };
  await legacy.table('sync_state').put(state);
  await legacy.table('sync_records').put({ id: 'settings:app', kind: 'settings', entityId: 'app', value: {
    appearance: { value: defaults.appearance, clock: 2, deviceId: 'device-2' },
    defaultEngineId: { value: 'google', clock: 3, deviceId: 'device-2' },
    layout: { value: defaults.layout, clock: 4, deviceId: 'device-2' },
    clock: { value: defaults.clock, clock: 5, deviceId: 'device-2' },
    searchPreferences: { value: { width: 'standard', autoFocus: false, openTarget: 'current-tab' }, clock: 6, deviceId: 'device-2' },
    searchCustomization: { value: customization, clock: 19, deviceId: 'device-2' },
    shortcutPreferences: { value: defaults.shortcuts, clock: 7, deviceId: 'device-2' }, customEngines: [],
  } });
  const key = { id: 'vault-2', key: { retained: 'key' } };
  await legacy.table('sync_keys').put(key);
  legacy.close();
  const current = createDatabase(name);
  databases.push(current);
  await current.open();
  const migrated = await current.settings.get('app');
  expect(migrated?.search.customization).toMatchObject({ corner: 'pill', engineKeywords: { google: 'web' }, engineOverrides: {} });
  const migratedRecord = await current.sync_records.get('settings:app');
  if (migratedRecord?.kind !== 'settings') throw new Error('迁移后的同步设置记录缺失');
  expect(migratedRecord.value.searchCustomization).toEqual({
    value: { ...customization, engineOverrides: {} }, clock: 19, deviceId: 'device-2',
  });
  expect(await current.sync_state.get('app')).toEqual(state);
  expect(await current.sync_keys.get('vault-2')).toEqual(key);
});

it('rolls back version 11 settings migration when existing settings are invalid', async () => {
  const name = crypto.randomUUID();
  const legacy = await createVersion11Database(name, true);
  const originalSettings = await legacy.table('settings').get('app');
  const originalState = await legacy.table('sync_state').get('app');
  legacy.close();
  const current = createDatabase(name);
  await expect(current.open()).rejects.toThrow(/时钟大小/);
  current.close();
  const unchanged = new Dexie(name);
  unchanged.version(11).stores(FOLDER_SCHEMA_STORES);
  await unchanged.open();
  databases.push(unchanged);
  expect(unchanged.verno).toBe(11);
  expect(await unchanged.table('settings').get('app')).toEqual(originalSettings);
  expect(await unchanged.table('sync_state').get('app')).toEqual(originalState);
});
