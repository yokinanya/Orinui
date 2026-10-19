import { afterEach, beforeEach, expect, it } from 'vitest';
import { createDataCommands } from '@/app/data-commands';
import { ensureInitialized } from '@/storage/init';
import { createDatabase, type Database } from '@/storage/db';
import { readSettings } from '@/storage/settings';

let db: Database;
let commands: ReturnType<typeof createDataCommands>;

beforeEach(async () => {
  db = createDatabase(`search-customization-${crypto.randomUUID()}`);
  await ensureInitialized(db);
  commands = createDataCommands({ db, loadFolders: async () => [], loadShortcuts: async () => {}, setSettings: () => {} });
});

afterEach(async () => { db.close(); await db.delete(); });

it('serializes rapid tool switches against persisted state without restoring another group', async () => {
  await Promise.all([commands.setSearchToolEnabled('github', false), commands.setSearchToolEnabled('color', false)]);
  expect((await readSettings(db)).search.customization.enabledTools).toEqual(['calculation', 'datetime']);
  await Promise.all([commands.setSearchToolEnabled('github', true), commands.setSearchToolEnabled('color', true)]);
  expect((await readSettings(db)).search.customization.enabledTools.toSorted()).toEqual(['calculation', 'color', 'datetime', 'github']);
});

it('updates search customization and manages per-engine keywords transactionally', async () => {
  await commands.updateSearchCustomization({ corner: 'pill', surfaceOpacity: 0, showSites: false });
  await commands.setSearchEngineKeyword('google', ' web ');
  await expect(commands.setSearchEngineKeyword('bing', 'WEB')).rejects.toThrow(/不能重复/);
  await expect(commands.setSearchEngineKeyword('google', 'gh')).rejects.toThrow(/冲突/);
  const beforeDelete = await readSettings(db);
  await commands.createSearchEngine({ name: 'Docs', template: 'https://example.test/?q={query}' });
  const created = (await readSettings(db)).search.customEngines.find(({ name }) => name === 'Docs');
  if (!created) throw new Error('自定义搜索引擎未创建');
  await commands.setSearchEngineKeyword(created.id, 'docs');
  await commands.deleteSearchEngine(created.id);
  const settings = await readSettings(db);
  expect(settings.search.customization).toMatchObject({ corner: 'pill', surfaceOpacity: 0, showSites: false });
  expect(settings.search.customization.engineKeywords).toEqual({ google: 'web' });
  expect(settings.search.customEngines).toEqual([]);
  expect(beforeDelete.search.customization.engineKeywords).toEqual({ google: 'web' });
});
