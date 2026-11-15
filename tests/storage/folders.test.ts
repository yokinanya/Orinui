import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import { createDatabase, type OrinuiDatabase } from '@/storage/db';
import {
  createFolder,
  deleteFolder,
  listChildFolders,
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
    expect(folder.parentId).toBeNull();
    expect(folder.order).toBe(0);
  });

  it('在指定父层创建时只占用该层顺序', async () => {
    const root = await createFolder(db, '根');
    const first = await createFolder(db, '子一', root.id);
    const second = await createFolder(db, '子二', root.id);

    expect(first).toMatchObject({ parentId: root.id, order: 0 });
    expect(second).toMatchObject({ parentId: root.id, order: 1 });
    expect((await listFolders(db)).filter(({ parentId }) => parentId === null)).toHaveLength(1);
  });

  it('拒绝不存在的父文件夹且不写入', async () => {
    await expect(createFolder(db, '子', 'missing')).rejects.toThrowError(/父文件夹不存在/);
    expect(await db.folders.count()).toBe(0);
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

describe('listChildFolders', () => {
  it('只返回直接子文件夹并按 order、其次 id 稳定排序', async () => {
    const root = await createFolder(db, '根');
    const zed = await createFolder(db, 'Zed', root.id);
    const alpha = await createFolder(db, 'Alpha', root.id);
    const nested = await createFolder(db, '嵌套', zed.id);
    // 人为造出同 order 的合法并存项，确认 tie 由 id 决定而不是读库顺序。
    await db.folders.put({ ...alpha, order: zed.order });

    const children = await listChildFolders(db, root.id);
    expect(children.map(({ id }) => id)).toEqual([alpha.id, zed.id].toSorted((left, right) => left < right ? -1 : 1));
    expect(children.map(({ parentId }) => parentId)).toEqual([root.id, root.id]);
    // 反复读取顺序一致，深层子树不混入这一层。
    expect((await listChildFolders(db, root.id)).map(({ id }) => id)).toEqual(children.map(({ id }) => id));
    expect(children.some(({ id }) => id === nested.id)).toBe(false);
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

describe('文件夹不可移动或重排', () => {
  it('moveFolder 明确失败且不写入', async () => {
    await createFolder(db, '工作');
    const life = await createFolder(db, '生活');

    await expect(moveFolder(db, life.id, 'up')).rejects.toThrowError(/不支持移动/);
    expect((await listFolders(db)).map((folder) => folder.name)).toEqual(['工作', '生活']);
  });

  it('reorderFolder 明确失败且不写入', async () => {
    const work = await createFolder(db, '工作');
    await createFolder(db, '生活');

    await expect(reorderFolder(db, work.id, 1)).rejects.toThrowError(/不支持重排/);
    expect((await listFolders(db)).map((folder) => folder.name)).toEqual(['工作', '生活']);
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

  it('删除后不重排目标层既有项，也不全局重编号', async () => {
    const work = await createFolder(db, '工作');
    const life = await createFolder(db, '生活');
    const fun = await createFolder(db, '娱乐');

    await deleteFolder(db, life.id);

    const folders = await listFolders(db);
    expect(folders.map((folder) => folder.name)).toEqual(['工作', '娱乐']);
    expect(folders.map((folder) => folder.order)).toEqual([0, 2]);
    expect(fun.id).toBe(folders[1]?.id);
    expect(work.order).toBe(0);
  });

  it('删除中层时只提升直接子文件夹与网站，按相对顺序追加到父层末尾', async () => {
    const root = await createFolder(db, '根');
    const middle = await createFolder(db, '中层', root.id);
    const sibling = await createFolder(db, '既有兄弟', root.id);
    const directA = await createFolder(db, '直接A', middle.id);
    const deep = await createFolder(db, '深层', directA.id);
    const directB = await createFolder(db, '直接B', middle.id);
    await addShortcut(middle.id, '中层网站一', 0);
    await addShortcut(middle.id, '中层网站二', 1);
    await addShortcut(root.id, '根层网站', 0);

    const result = await deleteFolder(db, middle.id);

    expect(result).toEqual({ movedShortcuts: 2, movedFolders: 2 });
    const layers = await listFolders(db);
    // 目标层既有项（sibling order 1）保持原位置，不重编号。
    expect(layers.find(({ id }) => id === sibling.id)?.order).toBe(1);
    // 直接子文件夹按原相对顺序追加到根层末尾；深层子树与标识不变。
    expect(layers.find(({ id }) => id === directA.id)).toMatchObject({ parentId: root.id, order: 2 });
    expect(layers.find(({ id }) => id === directB.id)).toMatchObject({ parentId: root.id, order: 3 });
    expect(layers.find(({ id }) => id === deep.id)).toMatchObject({ parentId: directA.id, order: 0 });
    expect(layers.some(({ id }) => id === middle.id)).toBe(false);
    // 网站按原相对顺序追加到根层末尾，根层既有网站位置不变。
    const sites = await db.shortcuts.toArray();
    expect(sites.find(({ title }) => title === '根层网站')?.order).toBe(0);
    expect(sites.find(({ title }) => title === '中层网站一')).toMatchObject({ folderId: root.id, order: 1 });
    expect(sites.find(({ title }) => title === '中层网站二')).toMatchObject({ folderId: root.id, order: 2 });
  });

  it('文件夹不存在时报错且不影响其他数据', async () => {
    await createFolder(db, '工作');

    await expect(deleteFolder(db, 'missing')).rejects.toThrowError(/文件夹不存在/);
    expect(await db.folders.count()).toBe(1);
  });
});
