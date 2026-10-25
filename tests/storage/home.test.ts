import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createFolder, deleteFolder } from '@/storage/folders';
import { createShortcut, moveShortcutToFolder } from '@/storage/shortcuts';
import { deleteWidget, moveHomeItem, saveWidget, resetHomePositions } from '@/storage/home';
import { readSettings } from '@/storage/settings';
import { createBackupSnapshot, replaceAllData, resetLocalData } from '@/storage/backup';
import { serializeBackup, readBackupFile } from '@/platform/backup-file';
import { initializeSyncVault } from '@/storage/sync/vault';
import { exportSyncSnapshot } from '@/storage/sync/export';
import { createSyncCrypto } from '@/platform/sync-crypto';

let db: Database;
beforeEach(async () => { db = createDatabase(`home-${crypto.randomUUID()}`); await ensureInitialized(db); });
afterEach(async () => { db.close(); await db.delete(); });
const note = { id: 'note', kind: 'note' as const, text: '<script>plain</script>', items: [] };
it('persists multiple widgets, todo CRUD, coordinates and deletion holes', async () => {
  await saveWidget(db, note);
  await saveWidget(db, { id: 'todo', kind: 'todo', text: '', items: [{ id: 'task', text: 'first', completed: false, order: 0 }] });
  await saveWidget(db, { id: 'todo', kind: 'todo', text: '', items: [{ id: 'task', text: 'edited', completed: true, order: 0 }] });
  await moveHomeItem(db, { id: 'widget:note', row: 5, column: 1, height: 4 });
  db.close(); await db.open();
  expect((await readSettings(db)).home?.widgets[1]?.items[0]).toMatchObject({ text: 'edited', completed: true });
  await deleteWidget(db, 'todo');
  expect((await readSettings(db)).home?.placements).toEqual([{ id: 'widget:note', row: 5, column: 1, height: 4 }]);
  await resetHomePositions(db);
  expect((await readSettings(db)).home?.widgets).toEqual([note]);
});
it('keeps folder transitions and their placements atomic', async () => {
  const folder = await createFolder(db, 'folder');
  const shortcut = await createShortcut(db, { title: 'site', url: 'example.com' });
  await moveShortcutToFolder(db, shortcut.id, folder.id);
  expect((await readSettings(db)).home?.placements.map(({ id }) => id)).toEqual([`folder:${folder.id}`]);
  await deleteFolder(db, folder.id);
  expect((await readSettings(db)).home?.placements.map(({ id }) => id)).toEqual([`shortcut:${shortcut.id}`]);
  await expect(moveHomeItem(db, { id: `shortcut:${shortcut.id}`, row: -1, column: 0, height: 1 })).rejects.toThrow();
  expect((await readSettings(db)).home?.placements[0]?.row).toBe(0);
});
it('round-trips widget plaintext and holes through an actual ZIP and resets explicitly', async () => {
  await saveWidget(db, note);
  await moveHomeItem(db, { id: 'widget:note', row: 4, column: 1, height: 2 });
  const expected = (await readSettings(db)).home;
  const blob = await serializeBackup(await createBackupSnapshot(db));
  const file = Object.assign(blob, { name: 'home.zip' }) as File;
  const backup = await readBackupFile(file);
  await resetLocalData(db);
  await replaceAllData(db, backup);
  expect((await readSettings(db)).home).toEqual(expected);
});
it('rolls back an invalid widget write with enabled sync metadata', async () => {
  const runtime = createSyncCrypto(globalThis.crypto);
  const { key } = await runtime.createKey();
  await initializeSyncVault(db, { vaultId: 'vault-home', deviceId: 'device-home', key });
  const state = await db.sync_state.get('app');
  await expect(saveWidget(db, { ...note, kind: 'unsupported' as 'note' })).rejects.toThrow();
  expect(await db.sync_state.get('app')).toEqual(state);
  expect((await readSettings(db)).home?.widgets).toHaveLength(0);
});
