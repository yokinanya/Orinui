import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@/domain/id';
import { createDefaultSettings } from '@/domain/settings';
import { toPortableSettings } from '@/domain/backup-settings';
import { BACKUP_VERSION } from '@/domain/backup';
import type { BackupDocument } from '@/domain/backup';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createFolder, deleteFolder } from '@/storage/folders';
import { createShortcut } from '@/storage/shortcuts';
import { createBackupSnapshot, replaceAllData, resetLocalData } from '@/storage/backup';
import { createMediaAsset } from '@/storage/assets';
import { readSettings, updateSettings } from '@/storage/settings';
import { readBackupFile, serializeBackup } from '@/platform/backup-file';

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
  it('ZIP 快照整块排除书签偏好、隐藏规则与浏览器标识', async () => {
    await updateSettings(db, (current) => ({ ...current, bookmarks: { enabled: true, mode: 'folder',
      showInSearch: false, hiddenRules: [{ ruleId: 'r1', targetId: 'browser-node-7',
        path: ['书签栏', '工作'], kind: 'folder', hidden: true, updatedAt: 5 }] } }));
    const snapshot = await createBackupSnapshot(db);
    expect(snapshot.settings).not.toHaveProperty('bookmarks');
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('browser-node-7');
    expect(serialized).not.toContain('书签栏');
    expect(serialized).not.toContain('hiddenRules');
    // 统计只来自自有数据，书签投影不参与计数。
    expect(snapshot.folders).toHaveLength(0);
    expect(snapshot.shortcuts).toHaveLength(0);
  });
  it('原子替换数据并支持空图片备份', async () => {
    const content: BackupDocument = {
      formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
      folders: [{ id: 'imported', parentId: null, name: '导入文件夹', order: 0 }],
      shortcuts: [], settings: { ...toPortableSettings(createDefaultSettings()),
        layout: { ...createDefaultSettings().layout, style: 'split' },
        clock: { ...createDefaultSettings().clock, format: '12h' } }, assets: [],
    };
    await replaceAllData(db, { document: content, assets: [] });
    expect((await db.folders.toArray()).map((folder) => folder.id)).toEqual(['imported']);
    expect((await createBackupSnapshot(db)).settings.clock.format).toBe('12h');
    expect((await createBackupSnapshot(db)).settings.layout.style).toBe('split');
  });
  it('导入 ZIP 恢复布局但保留本机书签偏好与隐藏规则', async () => {
    const rule = { ruleId: 'r1', targetId: 'browser-node-9', path: ['书签栏', '工作'],
      kind: 'folder' as const, hidden: true, updatedAt: 7 };
    await updateSettings(db, (current) => ({ ...current, bookmarks: { enabled: true, mode: 'folder',
      showInSearch: false, hiddenRules: [rule] } }));
    const content: BackupDocument = {
      formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
      folders: [{ id: 'imported', parentId: null, name: '导入文件夹', order: 0 }],
      shortcuts: [], settings: { ...toPortableSettings(createDefaultSettings()),
        layout: { ...createDefaultSettings().layout, style: 'split' } }, assets: [],
    };
    await replaceAllData(db, { document: content, assets: [] });

    const restored = await createBackupSnapshot(db);
    // 布局来自备份，书签偏好与规则原样保留本机现状。
    expect(restored.settings.layout.style).toBe('split');
    expect(await readSettings(db)).toMatchObject({ bookmarks: { enabled: true, mode: 'folder',
      showInSearch: false, hiddenRules: [rule] } });
    expect(restored.settings).not.toHaveProperty('bookmarks');
  });

  it('导出→生产 ZIP 序列化→读回→替换完整往返保留稀疏与并列 order', async () => {
    // 真实本地状态：删掉中间文件夹后目标层留下 0、2 两步，不重编号。
    await createFolder(db, '工作');
    const middle = await createFolder(db, '中间');
    await createFolder(db, '娱乐');
    await createShortcut(db, { folderId: null, title: '主页一', url: 'https://home-1.example/' });
    await createShortcut(db, { folderId: null, title: '主页二', url: 'https://home-2.example/' });
    await createShortcut(db, { folderId: null, title: '主页三', url: 'https://home-3.example/' });
    await deleteFolder(db, middle.id);
    // 直接制造并列 order：两台设备各自新建后同步物化保留原值，读取按 id 决胜。
    const tie = await createShortcut(db, { folderId: null, title: '主页四', url: 'https://home-4.example/' });
    const third = await db.shortcuts.filter(({ title }) => title === '主页三').first();
    if (!third) throw new Error('测试数据缺少主页三');
    await db.shortcuts.put({ ...tie, order: third.order });

    const rule = { ruleId: 'r1', targetId: 'browser-node-11', path: ['书签栏'],
      kind: 'root' as const, hidden: true, updatedAt: 9 };
    await updateSettings(db, (current) => ({ ...current, bookmarks: { enabled: true, mode: 'folder',
      showInSearch: false, hiddenRules: [rule] } }));

    const snapshot = await createBackupSnapshot(db);
    // 稀疏与并列是真实现象，不是手工构造的清单。
    expect(snapshot.folders.map(({ order }) => order).toSorted((a, b) => a - b)).toEqual([0, 2]);
    expect(new Set(snapshot.shortcuts.map(({ order }) => order)).size)
      .toBeLessThan(snapshot.shortcuts.length);

    // 走生产序列化入口；旧实现在这里就会因为不连续/重复 order 直接失败。
    const zipped = await serializeBackup(snapshot);
    const file = Object.assign(new Blob([await zipped.arrayBuffer()], { type: 'application/zip' }),
      { name: 'backup.zip' }) as File;
    const restored = await readBackupFile(file);
    await replaceAllData(db, { document: restored.document, assets: restored.assets });

    // 读回后 ID、parentId、order 与导出快照逐条一致，没有重编号或重排。
    const after = await createBackupSnapshot(db);
    expect(after.folders.map(({ id, parentId, order }) => [id, parentId, order]))
      .toEqual(snapshot.folders.map(({ id, parentId, order }) => [id, parentId, order]));
    expect(after.shortcuts.map(({ id, folderId, order }) => [id, folderId, order]))
      .toEqual(snapshot.shortcuts.map(({ id, folderId, order }) => [id, folderId, order]));
    // 书签偏好与隐藏规则仍是本机的，未被 ZIP 覆盖。
    expect(await readSettings(db)).toMatchObject({ bookmarks: { enabled: true, mode: 'folder',
      showInSearch: false, hiddenRules: [rule] } });
    expect(after.settings).not.toHaveProperty('bookmarks');
  });
});

describe('替换失败保护与数据重置', () => {
  it('替换失败时保留原数据库', async () => {
    const old = await createFolder(db, '旧文件夹');
    const invalid: BackupDocument = {
      formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
      folders: [{ id: 'main', parentId: null, name: '常用', order: 0 }],
      shortcuts: [{ id: 'broken', folderId: 'missing', title: '', url: 'https://example.com',
        icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 }],
      settings: toPortableSettings(createDefaultSettings()), assets: [],
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
    expect((await createBackupSnapshot(db)).settings).toEqual(toPortableSettings(createDefaultSettings()));
  });
});
