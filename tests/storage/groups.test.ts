import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import { createDatabase, type OrinuiDatabase } from '@/storage/db';
import {
  DEFAULT_GROUP_NAME,
  createGroup,
  deleteGroup,
  ensureDefaultGroup,
  listGroups,
  moveGroup,
  renameGroup,
  reorderGroup,
} from '@/storage/groups';

let db: OrinuiDatabase;

beforeEach(async () => {
  db = createDatabase(`test-${newId()}`);
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('ensureDefaultGroup', () => {
  it('首次调用创建一个空的默认分组', async () => {
    const group = await ensureDefaultGroup(db);

    expect(group.name).toBe(DEFAULT_GROUP_NAME);
    expect(group.isDefault).toBe(true);
    expect(group.colorRole).toBe('primary');
    expect(group.order).toBe(0);
  });

  it('重复调用不会新增分组', async () => {
    const first = await ensureDefaultGroup(db);
    const second = await ensureDefaultGroup(db);

    expect(second.id).toBe(first.id);
    expect(await db.groups.count()).toBe(1);
  });

  it('已有分组但缺少默认分组时明确报错，而不是顶替一个分组', async () => {
    await db.groups.add({
      id: newId(),
      name: '工作',
      colorRole: null,
      order: 0,
      isDefault: false,
    });

    await expect(ensureDefaultGroup(db)).rejects.toThrowError(/缺少默认分组/);
  });
});

describe('createGroup', () => {
  it('追加到末尾并规范化名称', async () => {
    await ensureDefaultGroup(db);
    const group = await createGroup(db, '  工作  ');

    expect(group.name).toBe('工作');
    expect(group.order).toBe(1);
    expect(group.isDefault).toBe(false);
  });

  it('允许同名分组', async () => {
    await ensureDefaultGroup(db);
    await createGroup(db, '工作');
    await createGroup(db, '工作');

    const groups = await listGroups(db);
    expect(groups.map((group) => group.name)).toEqual(['常用', '工作', '工作']);
  });

  it('达到上限时拒绝并保持数量不变', async () => {
    await ensureDefaultGroup(db);
    for (let index = 1; index < LIMITS.groups; index += 1) {
      await createGroup(db, `分组 ${index}`);
    }

    await expect(createGroup(db, '再一个')).rejects.toThrowError(/最多只能有/);
    expect(await db.groups.count()).toBe(LIMITS.groups);
  });

  it('名称为空时拒绝且不写入', async () => {
    await ensureDefaultGroup(db);

    await expect(createGroup(db, '   ')).rejects.toThrowError(/不能为空/);
    expect(await db.groups.count()).toBe(1);
  });
});

describe('renameGroup', () => {
  it('改名不影响顺序与默认角色', async () => {
    const group = await ensureDefaultGroup(db);
    const renamed = await renameGroup(db, group.id, '首页');

    expect(renamed.name).toBe('首页');
    expect(renamed.order).toBe(group.order);
    expect(renamed.isDefault).toBe(true);
  });

  it('分组不存在时报错', async () => {
    await expect(renameGroup(db, 'missing', '名称')).rejects.toThrowError(/分组不存在/);
  });
});

describe('moveGroup', () => {
  it('与相邻分组交换位置', async () => {
    await ensureDefaultGroup(db);
    const work = await createGroup(db, '工作');

    expect(await moveGroup(db, work.id, 'up')).toBe(true);
    expect((await listGroups(db)).map((group) => group.name)).toEqual(['工作', '常用']);
  });

  it('已在边界时返回 false 且顺序不变', async () => {
    const group = await ensureDefaultGroup(db);

    expect(await moveGroup(db, group.id, 'up')).toBe(false);
    expect(await moveGroup(db, group.id, 'down')).toBe(false);
    expect((await listGroups(db)).map((item) => item.name)).toEqual([DEFAULT_GROUP_NAME]);
  });
});

describe('reorderGroup', () => {
  it('移动到指定下标并重新编号', async () => {
    await ensureDefaultGroup(db);
    const work = await createGroup(db, '工作');
    const life = await createGroup(db, '生活');

    await reorderGroup(db, life.id, 0);

    const groups = await listGroups(db);
    expect(groups.map((group) => group.name)).toEqual(['生活', DEFAULT_GROUP_NAME, '工作']);
    expect(groups.map((group) => group.order)).toEqual([0, 1, 2]);
  });

  it('目标下标越界时收敛到末尾', async () => {
    await ensureDefaultGroup(db);
    const work = await createGroup(db, '工作');

    await reorderGroup(db, work.id, 99);

    expect((await listGroups(db)).map((group) => group.name)).toEqual([DEFAULT_GROUP_NAME, '工作']);
  });

  it('标识不存在时报错且顺序不变', async () => {
    await ensureDefaultGroup(db);
    await createGroup(db, '工作');

    await expect(reorderGroup(db, 'missing', 0)).rejects.toThrowError(/分组不存在/);
    expect((await listGroups(db)).map((group) => group.name)).toEqual([DEFAULT_GROUP_NAME, '工作']);
  });
});

describe('deleteGroup', () => {
  it('删除分组并连同组内网站一起删除', async () => {
    await ensureDefaultGroup(db);
    const work = await createGroup(db, '工作');
    await db.shortcuts.bulkAdd([
      {
        id: newId(),
        groupId: work.id,
        title: '文档',
        url: 'https://example.com',
        icon: { kind: 'letter' },
        iconSourceUrl: null,
        order: 0,
      },
      {
        id: newId(),
        groupId: work.id,
        title: '邮箱',
        url: 'https://mail.example.com',
        icon: { kind: 'letter' },
        iconSourceUrl: null,
        order: 1,
      },
    ]);

    const result = await deleteGroup(db, work.id);

    expect(result.removedShortcuts).toBe(2);
    expect(await db.shortcuts.count()).toBe(0);
    expect(await listGroups(db)).toHaveLength(1);
  });

  it('默认分组不能删除', async () => {
    const group = await ensureDefaultGroup(db);

    await expect(deleteGroup(db, group.id)).rejects.toThrowError(/默认分组不能删除/);
    expect(await db.groups.count()).toBe(1);
  });

  it('删除后重新编号，保持位置连续', async () => {
    await ensureDefaultGroup(db);
    const work = await createGroup(db, '工作');
    const fun = await createGroup(db, '娱乐');

    await deleteGroup(db, work.id);

    const groups = await listGroups(db);
    expect(groups.map((group) => group.name)).toEqual(['常用', '娱乐']);
    expect(groups.map((group) => group.order)).toEqual([0, 1]);
    expect(fun.id).toBe(groups[1]?.id);
  });

  it('分组不存在时报错且不影响其他数据', async () => {
    await ensureDefaultGroup(db);

    await expect(deleteGroup(db, 'missing')).rejects.toThrowError(/分组不存在/);
    expect(await db.groups.count()).toBe(1);
  });
});
