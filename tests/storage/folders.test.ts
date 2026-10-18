import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import { createDatabase, type OrinuiDatabase } from '@/storage/db';
import {
  createFolder,
  deleteFolder,
  listFolders,
  moveFolder,
  renameFolder,
  reorderFolder,
} from '@/storage/folders';
import { listHomepageShortcuts } from '@/storage/shortcuts';

let db: OrinuiDatabase;

beforeEach(async () => {
  db = createDatabase(`test-${newId()}`);
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

async function addShortcut(folderId: string | null, title: string, order: number): Promise<string> {
  const id = newId();
  await db.shortcuts.add({ id, folderId, title, url: `https://${order}.example.com`, icon: { kind: 'letter' },
    iconSourceUrl: null, order });
  return id;
}

describe('createFolder', () => {
  it('追加到末尾并规范化名称', async () => {
    const folder = await createFolder(db, '  工作  ');

    expect(folder.name).toBe('工作');
    expect(folder.order).toBe(0);
  });

  it('允许同名文件夹并保留独立身份', async () => {
    await createFolder(db, '工作');

    const second = await createFolder(db, '工作');
    const folders = await listFolders(db);
    expect(folders).toHaveLength(2);
    expect(folders[0]?.id).not.toBe(second.id);
    expect(folders.map(({ name }) => name)).toEqual(['工作', '工作']);
  });

  it('达到上限时拒绝并保持数量不变', async () => {
    for (let index = 0; index < LIMITS.folders; index += 1) await createFolder(db, `文件夹 ${index}`);

    await expect(createFolder(db, '再一个')).rejects.toThrowError(/最多只能有/);
    expect(await db.folders.count()).toBe(LIMITS.folders);
  });

  it('名称为空时拒绝且不写入', async () => {
    await expect(createFolder(db, '   ')).rejects.toThrowError(/不能为空/);
    expect(await db.folders.count()).toBe(0);
  });
});

describe('renameFolder', () => {
  it('改名保持顺序', async () => {
    const folder = await createFolder(db, '工作');
    const renamed = await renameFolder(db, folder.id, '文档');

    expect(renamed.name).toBe('文档');
    expect(renamed.order).toBe(folder.order);
  });

  it('允许改成已有名称而不合并文件夹', async () => {
    await createFolder(db, '工作');
    const life = await createFolder(db, '生活');

    expect((await renameFolder(db, life.id, '工作')).id).toBe(life.id);
    expect((await listFolders(db)).map(({ name }) => name)).toEqual(['工作', '工作']);
  });

  it('文件夹不存在时报错', async () => {
    await expect(renameFolder(db, 'missing', '名称')).rejects.toThrowError(/文件夹不存在/);
  });
});

describe('moveFolder', () => {
  it('与相邻文件夹交换位置', async () => {
    await createFolder(db, '工作');
    const life = await createFolder(db, '生活');

    expect(await moveFolder(db, life.id, 'up')).toBe(true);
    expect((await listFolders(db)).map((folder) => folder.name)).toEqual(['生活', '工作']);
  });

  it('已在边界时返回 false 且顺序不变', async () => {
    const folder = await createFolder(db, '工作');

    expect(await moveFolder(db, folder.id, 'up')).toBe(false);
    expect(await moveFolder(db, folder.id, 'down')).toBe(false);
    expect((await listFolders(db)).map((item) => item.name)).toEqual(['工作']);
  });
});

describe('reorderFolder', () => {
  it('移动到指定下标并重新编号', async () => {
    await createFolder(db, '工作');
    await createFolder(db, '生活');
    const fun = await createFolder(db, '娱乐');

    await reorderFolder(db, fun.id, 0);

    const folders = await listFolders(db);
    expect(folders.map((folder) => folder.name)).toEqual(['娱乐', '工作', '生活']);
    expect(folders.map((folder) => folder.order)).toEqual([0, 1, 2]);
  });

  it('目标下标越界时收敛到末尾', async () => {
    const work = await createFolder(db, '工作');
    await createFolder(db, '生活');

    await reorderFolder(db, work.id, 99);

    expect((await listFolders(db)).map((folder) => folder.name)).toEqual(['生活', '工作']);
  });

  it('标识不存在时报错且顺序不变', async () => {
    await createFolder(db, '工作');

    await expect(reorderFolder(db, 'missing', 0)).rejects.toThrowError(/文件夹不存在/);
    expect((await listFolders(db)).map((folder) => folder.name)).toEqual(['工作']);
  });
});

describe('deleteFolder', () => {
  it('删除文件夹时把其中的网站移回主页网格末尾', async () => {
    const work = await createFolder(db, '工作');
    const homeId = await addShortcut(null, '主页站点', 0);
    await addShortcut(work.id, '文档', 0);
    await addShortcut(work.id, '邮箱', 1);

    const result = await deleteFolder(db, work.id);

    expect(result.movedShortcuts).toBe(2);
    const homepage = await listHomepageShortcuts(db);
    expect(homepage.map((shortcut) => shortcut.title)).toEqual(['主页站点', '文档', '邮箱']);
    expect(homepage.map((shortcut) => shortcut.order)).toEqual([0, 1, 2]);
    expect(homepage[0]?.id).toBe(homeId);
    expect(await listFolders(db)).toHaveLength(0);
  });

  it('删除后重新编号，保持位置连续', async () => {
    const work = await createFolder(db, '工作');
    const life = await createFolder(db, '生活');
    const fun = await createFolder(db, '娱乐');

    await deleteFolder(db, life.id);

    const folders = await listFolders(db);
    expect(folders.map((folder) => folder.name)).toEqual(['工作', '娱乐']);
    expect(folders.map((folder) => folder.order)).toEqual([0, 1]);
    expect(fun.id).toBe(folders[1]?.id);
  });

  it('文件夹不存在时报错且不影响其他数据', async () => {
    await createFolder(db, '工作');

    await expect(deleteFolder(db, 'missing')).rejects.toThrowError(/文件夹不存在/);
    expect(await db.folders.count()).toBe(1);
  });
});
