import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/domain/id';
import { createDefaultSettings } from '@/domain/settings';
import { BACKUP_VERSION } from '@/domain/backup';
import type { BackupDocument } from '@/domain/backup';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createFolder } from '@/storage/folders';
import { createShortcut } from '@/storage/shortcuts';
import { createBackupSnapshot, replaceAllData, resetLocalData } from '@/storage/backup';
import { createMediaAsset } from '@/storage/assets';

let db: Database;
beforeEach(async () => { db = createDatabase(`backup-${newId()}`); await ensureInitialized(db); });
afterEach(async () => { db.close(); await db.delete(); });

describe('备份导出与原子替换', () => {
  it('完整备份包含未激活壁纸素材', async () => {
    await createMediaAsset(db, { kind: 'background', mime: 'image/png', width: 1, height: 1,
      blob: new Blob(['photo'], { type: 'image/png' }) });
    const snapshot = await createBackupSnapshot(db);
    expect(snapshot.assets).toHaveLength(1);
    expect(snapshot.assets[0]?.kind).toBe('background');
  });
  it('导出按文件夹和网站顺序创建一致快照', async () => {
    const first = (await createFolder(db, '工作')).id;
    await createShortcut(db, { folderId: first, title: '站点二', url: 'https://example.com/2' });
    await createShortcut(db, { folderId: first, title: '站点一', url: 'https://example.com/1' });
    const snapshot = await createBackupSnapshot(db);
    expect(snapshot.folders.map((folder) => folder.order)).toEqual([0]);
    expect(snapshot.shortcuts.map((item) => item.title)).toEqual(['站点二', '站点一']);
    expect(snapshot.settings.search.defaultEngineId).toBe('google');
  });
  it('原子替换数据并支持空图片备份', async () => {
    const content: BackupDocument = {
      formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
      folders: [{ id: 'imported', name: '导入文件夹', order: 0 }],
      shortcuts: [], settings: { ...createDefaultSettings(),
        layout: { ...createDefaultSettings().layout, style: 'split' },
        clock: { ...createDefaultSettings().clock, format: '12h' } }, assets: [],
    };
    await replaceAllData(db, { document: content, assets: [] });
    expect((await db.folders.toArray()).map((folder) => folder.id)).toEqual(['imported']);
    expect((await createBackupSnapshot(db)).settings.clock.format).toBe('12h');
    expect((await createBackupSnapshot(db)).settings.layout.style).toBe('split');
  });
});

describe('替换失败保护与数据重置', () => {
  it('替换失败时保留原数据库', async () => {
    const old = await createFolder(db, '旧文件夹');
    const invalid: BackupDocument = {
      formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
      folders: [{ id: 'main', name: '常用', order: 0 }],
      shortcuts: [{ id: 'broken', folderId: 'missing', title: '', url: 'https://example.com',
        icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }],
      settings: createDefaultSettings(), assets: [],
    };
    await expect(replaceAllData(db, { document: invalid, assets: [] })).rejects.toThrow(/文件夹不存在/);
    expect(await db.folders.get(old.id)).toBeDefined();
  });
  it('重置清空快捷方式和图片并恢复默认设置', async () => {
    const folder = await createFolder(db, '工作');
    await createShortcut(db, { folderId: folder.id, title: '网站', url: 'https://example.com' });
    await db.assets.add({ id: 'temporary', kind: 'icon', mime: 'image/png', width: 1, height: 1,
      blob: new Blob(['data'], { type: 'image/png' }), sourceUrl: null });
    await resetLocalData(db);
    expect(await db.shortcuts.count()).toBe(0);
    expect(await db.assets.count()).toBe(0);
    expect(await db.folders.count()).toBe(0);
    expect((await createBackupSnapshot(db)).settings).toEqual(createDefaultSettings());
  });
});
