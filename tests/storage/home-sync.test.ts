import { afterEach, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { saveWidget, moveHomeItem, deleteWidget } from '@/storage/home';
import { readSettings } from '@/storage/settings';
import { initializeSyncVault } from '@/storage/sync/vault';
import { exportSyncSnapshot } from '@/storage/sync/export';
import { applySyncSnapshot } from '@/storage/sync/apply';
import { mergeSyncSnapshots } from '@/domain/sync';
import { createSyncCrypto } from '@/platform/sync-crypto';

const runtime = createSyncCrypto(globalThis.crypto);
const databases: Database[] = [];
afterEach(async () => { for (const db of databases.splice(0)) { db.close(); await db.delete(); } });
async function device(id: string, key: CryptoKey) {
  const db = createDatabase(`home-sync-${crypto.randomUUID()}`); databases.push(db);
  await initializeSyncVault(db, { vaultId: 'home-vault', deviceId: id, key });
  return db;
}
async function apply(db: Database, snapshot: Awaited<ReturnType<typeof exportSyncSnapshot>>['snapshot']) {
  const state = await db.sync_state.get('app');
  await applySyncSnapshot(db, { snapshot, assets: [], expectedGeneration: state!.generation },
    { crypto: runtime, validateStoredMediaAsset: async (asset) => asset });
}
it('converges note/todo edits, concurrent placements and deletions through real capture/export/apply', async () => {
  const { key } = await runtime.createKey();
  const a = await device('a', key); const b = await device('b', key);
  await saveWidget(a, { id: 'note', kind: 'note', text: 'initial', items: [] });
  await saveWidget(a, { id: 'todo', kind: 'todo', text: '', items: [{ id: 'task', text: 'task', completed: false, order: 0 }] });
  const initial = await exportSyncSnapshot(a, runtime); const empty = await exportSyncSnapshot(b, runtime);
  await apply(b, mergeSyncSnapshots({ local: empty.snapshot, remotes: [initial.snapshot] }));
  await saveWidget(a, { id: 'note', kind: 'note', text: 'offline note', items: [] });
  await saveWidget(b, { id: 'todo', kind: 'todo', text: '', items: [{ id: 'task', text: 'task', completed: true, order: 0 }] });
  await moveHomeItem(a, { id: 'widget:note', column: 0, row: 4, height: 4 });
  await moveHomeItem(b, { id: 'widget:todo', column: 0, row: 4, height: 2 });
  const left = await exportSyncSnapshot(a, runtime); const right = await exportSyncSnapshot(b, runtime);
  const merged = mergeSyncSnapshots({ local: left.snapshot, remotes: [right.snapshot] });
  await apply(a, merged);
  await apply(b, mergeSyncSnapshots({ local: right.snapshot, remotes: [merged] }));
  expect((await readSettings(a)).home).toEqual((await readSettings(b)).home);
  expect((await readSettings(a)).home?.widgets.find(({ id }) => id === 'note')?.text).toBe('offline note');
  expect((await readSettings(a)).home?.widgets.find(({ id }) => id === 'todo')?.items[0]?.completed).toBe(true);
  await deleteWidget(a, 'note');
  const deleted = await exportSyncSnapshot(a, runtime); const prior = await exportSyncSnapshot(b, runtime);
  await apply(b, mergeSyncSnapshots({ local: prior.snapshot, remotes: [deleted.snapshot] }));
  expect((await readSettings(b)).home?.widgets.map(({ id }) => id)).toEqual(['todo']);
  expect((await a.sync_keys.get('home-vault'))?.key.extractable).toBe(false);
});
