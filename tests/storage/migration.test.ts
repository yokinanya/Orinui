import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { createDefaultSettings } from '@/domain/settings';

const databases: Dexie[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) { database.close(); await database.delete(); }
});

it('opens a fresh schema 11 database without legacy tables or content', async () => {
  const database = createDatabase(crypto.randomUUID());
  databases.push(database);
  await database.open();
  expect(database.verno).toBe(11);
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
