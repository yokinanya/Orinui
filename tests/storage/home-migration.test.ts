import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { createDatabase } from '@/storage/db';
import { createDefaultSettings } from '@/domain/settings';

it('migrates schema 13 row-major, preserves relations and key, normalizes retired layout choices', async () => {
  const name = `home-migration-${crypto.randomUUID()}`;
  const legacy = new Dexie(name);
  legacy.version(13).stores({ folders: 'id, order', shortcuts: 'id, folderId, order', settings: 'id', assets: 'id, kind',
    sync_state: 'id', sync_records: 'id, kind, entityId', sync_keys: 'id' });
  await legacy.open();
  const defaults = createDefaultSettings();
  const { home: _home, ...oldSettings } = defaults;
  await legacy.table('settings').put({ ...oldSettings, id: 'app', layout: { ...defaults.layout, style: 'split',
    order: ['shortcuts', 'clock', 'search'], columns: 8, clockPosition: 'right', hidden: ['clock'] },
    shortcuts: { ...defaults.shortcuts, showNames: false } });
  await legacy.table('folders').bulkPut([{ id: 'folder-b', name: 'B', order: 1 }, { id: 'folder-a', name: 'A', order: 0 }]);
  const shortcut = { title: 'site', url: 'https://example.com/', icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 };
  await legacy.table('shortcuts').bulkPut([{ ...shortcut, id: 'home', folderId: null }, { ...shortcut, id: 'inside', folderId: 'folder-b' }]);
  const { key } = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']).then((key) => ({ key }));
  await legacy.table('sync_keys').put({ id: 'vault', key });
  const relations = await legacy.table('shortcuts').toArray();
  legacy.close();
  const db = createDatabase(name);
  try {
    await db.open();
    const settings = await db.settings.get('app');
    expect(settings?.home?.placements).toEqual([
      { id: 'folder:folder-a', column: 0, row: 0, height: 1 },
      { id: 'folder:folder-b', column: 1, row: 0, height: 1 },
      { id: 'shortcut:home', column: 0, row: 1, height: 1 },
    ]);
    expect(settings?.layout).toMatchObject({ ...defaults.layout, hidden: ['clock'] });
    expect(settings?.shortcuts.showNames).toBe(true);
    expect(await db.shortcuts.toArray()).toEqual(relations);
    expect((await db.sync_keys.get('vault'))?.key.extractable).toBe(false);
  } finally { db.close(); await db.delete(); }
});
