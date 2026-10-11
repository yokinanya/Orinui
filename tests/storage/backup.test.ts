import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/domain/id';
import { createDefaultSettings } from '@/domain/settings';
import type { BackupDocument } from '@/domain/backup';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createGroup, updateGroupColor } from '@/storage/groups';
import { createShortcut } from '@/storage/shortcuts';
import { createBackupSnapshot, replaceAllData, resetLocalData } from '@/storage/backup';

let db: Database;
beforeEach(async () => { db = createDatabase(`backup-${newId()}`); await ensureInitialized(db); });
afterEach(async () => { db.close(); await db.delete(); });

describe('备份导出与原子替换', () => {
  it('导出按分组和网站顺序创建一致快照', async () => {
    const first = (await createGroup(db, '工作')).id;
    await createShortcut(db, { groupId: first, title: '站点二', url: 'https://example.com/2' });
    await createShortcut(db, { groupId: first, title: '站点一', url: 'https://example.com/1' });
    const snapshot = await createBackupSnapshot(db);
    expect(snapshot.groups.map((group) => group.order)).toEqual([0, 1]);
    expect(snapshot.shortcuts.map((item) => item.title)).toEqual(['站点二', '站点一']);
    expect(snapshot.settings.search.defaultEngineId).toBe('google');
  });
  it('原子替换数据并支持空图片备份', async () => {
    const content: BackupDocument = {
      version: 1, exportedAt: new Date().toISOString(),
      groups: [{ id: 'imported', name: '导入组', colorRole: 'primary', order: 0, isDefault: true }],
      shortcuts: [], settings: { ...createDefaultSettings(), clock: { format: '12h' } }, assets: [],
    };
    await replaceAllData(db, { document: content, assets: [] });
    expect((await db.groups.toArray()).map((group) => group.id)).toEqual(['imported']);
    expect((await createBackupSnapshot(db)).settings.clock.format).toBe('12h');
  });
});

describe('替换失败保护与数据重置', () => {
  it('替换失败时保留原数据库', async () => {
    const old = await createGroup(db, '旧组');
    const invalid: BackupDocument = {
      version: 1, exportedAt: new Date().toISOString(),
      groups: [{ id: 'main', name: '常用', colorRole: 'primary', order: 0, isDefault: false }],
      shortcuts: [], settings: createDefaultSettings(), assets: [],
    };
    await expect(replaceAllData(db, { document: invalid, assets: [] })).rejects.toThrow(/恰好/);
    expect(await db.groups.get(old.id)).toBeDefined();
  });
  it('重置清空快捷方式和图片并恢复默认设置', async () => {
    const group = (await db.groups.toArray())[0];
    if (!group) throw new Error('Missing default group');
    await createShortcut(db, { groupId: group.id, title: '网站', url: 'https://example.com' });
    await db.assets.add({ id: 'temporary', kind: 'icon', mime: 'image/png', width: 1, height: 1,
      blob: new Blob(['data'], { type: 'image/png' }), sourceUrl: null });
    await resetLocalData(db);
    expect(await db.shortcuts.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);
    expect(await db.groups.toArray()).toMatchObject([{ name: '常用', isDefault: true, colorRole: 'primary' }]);
    expect((await createBackupSnapshot(db)).settings).toEqual(createDefaultSettings());
  });
  it('自定义分组颜色可写入语义角色，但默认组保留主色', async () => {
    const primary = (await db.groups.toArray())[0];
    if (!primary) throw new Error('Missing default group');
    await expect(updateGroupColor(db, primary.id, 'tertiary')).rejects.toThrow(/默认分组/);
    const work = await createGroup(db, '工作');
    await updateGroupColor(db, work.id, 'tertiary');
    expect((await db.groups.get(work.id))?.colorRole).toBe('tertiary');
    expect((await db.groups.get(primary.id))?.colorRole).toBe('primary');
  });
});
