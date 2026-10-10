import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Group } from '@/domain/group';
import { newId } from '@/domain/id';
import { LIMITS } from '@/domain/limits';
import { createDatabase, type OrinuiDatabase } from '@/storage/db';
import { ensureDefaultGroup } from '@/storage/groups';
import {
  createShortcut,
  deleteShortcut,
  listShortcuts,
  moveShortcut,
  moveShortcutToGroup,
  reorderShortcut,
  restoreShortcut,
  updateShortcut,
} from '@/storage/shortcuts';

let db: OrinuiDatabase;
let group: Group;
let work: Group;

beforeEach(async () => {
  db = createDatabase(`test-${newId()}`);
  await db.open();
  group = await ensureDefaultGroup(db);
  work = await (async () => {
    const created: Group = {
      id: newId(),
      name: '工作',
      colorRole: null,
      order: 1,
      isDefault: false,
    };
    await db.groups.add(created);
    return created;
  })();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

async function addThree(target: Group) {
  const first = await createShortcut(db, { groupId: target.id, title: '一', url: 'https://a.example' });
  const second = await createShortcut(db, { groupId: target.id, title: '二', url: 'https://b.example' });
  const third = await createShortcut(db, { groupId: target.id, title: '三', url: 'https://c.example' });
  return { first, second, third };
}

describe('createShortcut', () => {
  it('追加到分组末尾并补齐默认图标', async () => {
    const first = await createShortcut(db, { groupId: group.id, title: '文档', url: 'example.com/docs' });

    expect(first.order).toBe(0);
    expect(first.url).toBe('https://example.com/docs');
    expect(first.icon).toEqual({ kind: 'letter' });
    expect(first.iconSourceUrl).toBeNull();
  });

  it('规范化标题与地址', async () => {
    const created = await createShortcut(db, {
      groupId: group.id,
      title: '  文档  ',
      url: '  example.com  ',
    });

    expect(created.title).toBe('文档');
    expect(created.url).toBe('https://example.com');
  });

  it('目标分组不存在时报错且不写入', async () => {
    await expect(
      createShortcut(db, { groupId: 'missing', title: '文档', url: 'example.com' }),
    ).rejects.toThrowError(/目标分组不存在/);
    expect(await db.shortcuts.count()).toBe(0);
  });

  it('非法地址时报错且不写入', async () => {
    await expect(
      createShortcut(db, { groupId: group.id, title: '文档', url: 'javascript:alert(1)' }),
    ).rejects.toThrowError(/只支持 http 或 https/);
    expect(await db.shortcuts.count()).toBe(0);
  });

  it('达到全局上限时拒绝', async () => {
    await db.shortcuts.bulkAdd(
      Array.from({ length: LIMITS.shortcuts }, (_, index) => ({
        id: `seed-${index}`,
        groupId: group.id,
        title: `站点 ${index}`,
        url: `https://example.com/${index}`,
        icon: { kind: 'letter' as const },
        iconSourceUrl: null,
        order: index,
      })),
    );

    await expect(
      createShortcut(db, { groupId: group.id, title: '再多一个', url: 'https://example.com/extra' }),
    ).rejects.toThrowError(/最多只能有/);
    expect(await db.shortcuts.count()).toBe(LIMITS.shortcuts);
  });

  it('两个分组各自独立编号', async () => {
    await addThree(group);
    const inWork = await createShortcut(db, { groupId: work.id, title: '工作一', url: 'https://w.example' });

    expect(inWork.order).toBe(0);
    expect((await listShortcuts(db, group.id)).map((item) => item.order)).toEqual([0, 1, 2]);
  });
});

describe('updateShortcut', () => {
  it('只更新传入的字段', async () => {
    const created = await createShortcut(db, {
      groupId: group.id,
      title: '文档',
      url: 'https://example.com',
    });

    const updated = await updateShortcut(db, created.id, { title: '新文档' });

    expect(updated.title).toBe('新文档');
    expect(updated.url).toBe('https://example.com');
    expect(updated.order).toBe(created.order);
  });

  it('校验失败时保持原记录不变', async () => {
    const created = await createShortcut(db, {
      groupId: group.id,
      title: '文档',
      url: 'https://example.com',
    });

    await expect(updateShortcut(db, created.id, { url: 'file:///tmp/x' })).rejects.toThrowError(
      /只支持 http 或 https/,
    );
    expect((await db.shortcuts.get(created.id))?.url).toBe('https://example.com');
  });

  it('记录不存在时报错', async () => {
    await expect(updateShortcut(db, 'missing', { title: 'x' })).rejects.toThrowError(/网站不存在/);
  });
});

describe('deleteShortcut 与 restoreShortcut', () => {
  it('删除后重新编号，返回被删除的记录', async () => {
    const { second } = await addThree(group);

    const removed = await deleteShortcut(db, second.id);

    expect(removed.title).toBe('二');
    expect((await listShortcuts(db, group.id)).map((item) => item.title)).toEqual(['一', '三']);
    expect((await listShortcuts(db, group.id)).map((item) => item.order)).toEqual([0, 1]);
  });

  it('撤销后回到分组末尾', async () => {
    const { second } = await addThree(group);
    const removed = await deleteShortcut(db, second.id);

    await restoreShortcut(db, removed);

    expect((await listShortcuts(db, group.id)).map((item) => item.title)).toEqual(['一', '三', '二']);
  });

  it('原分组已删除时撤销明确报错', async () => {
    const created = await createShortcut(db, {
      groupId: work.id,
      title: '工作一',
      url: 'https://w.example',
    });
    const removed = await deleteShortcut(db, created.id);
    await db.groups.delete(work.id);

    await expect(restoreShortcut(db, removed)).rejects.toThrowError(/原分组已被删除/);
  });

  it('删除不存在的记录时报错', async () => {
    await expect(deleteShortcut(db, 'missing')).rejects.toThrowError(/网站不存在/);
  });
});

describe('moveShortcut', () => {
  it('与相邻项交换位置', async () => {
    const { second } = await addThree(group);

    expect(await moveShortcut(db, second.id, 'up')).toBe(true);
    expect((await listShortcuts(db, group.id)).map((item) => item.title)).toEqual(['二', '一', '三']);
  });

  it('越界时返回 false 且顺序不变', async () => {
    const { first } = await addThree(group);

    expect(await moveShortcut(db, first.id, 'up')).toBe(false);
    expect((await listShortcuts(db, group.id)).map((item) => item.title)).toEqual(['一', '二', '三']);
  });
});

describe('reorderShortcut', () => {
  it('移动到组内指定下标并重新编号', async () => {
    const { first } = await addThree(group);

    await reorderShortcut(db, first.id, 2);

    expect((await listShortcuts(db, group.id)).map((item) => item.title)).toEqual(['二', '三', '一']);
    expect((await listShortcuts(db, group.id)).map((item) => item.order)).toEqual([0, 1, 2]);
  });

  it('目标下标越界时收敛到末尾', async () => {
    const { second } = await addThree(group);

    await reorderShortcut(db, second.id, 99);

    expect((await listShortcuts(db, group.id)).map((item) => item.title)).toEqual(['一', '三', '二']);
  });

  it('不影响其他分组的编号', async () => {
    await addThree(group);
    const other = await createShortcut(db, { groupId: work.id, title: '工作一', url: 'https://w.example' });

    await reorderShortcut(db, other.id, 0);

    expect((await listShortcuts(db, group.id)).map((item) => item.order)).toEqual([0, 1, 2]);
    expect((await listShortcuts(db, work.id)).map((item) => item.order)).toEqual([0]);
  });

  it('标识不存在时报错且顺序不变', async () => {
    await addThree(group);

    await expect(reorderShortcut(db, 'missing', 0)).rejects.toThrowError(/网站不存在/);
    expect((await listShortcuts(db, group.id)).map((item) => item.title)).toEqual(['一', '二', '三']);
  });
});

describe('moveShortcutToGroup', () => {
  it('移动到目标分组末尾并重排原分组', async () => {
    const { second } = await addThree(group);

    const moved = await moveShortcutToGroup(db, second.id, work.id);

    expect(moved.groupId).toBe(work.id);
    expect(moved.order).toBe(0);
    expect((await listShortcuts(db, group.id)).map((item) => item.title)).toEqual(['一', '三']);
    expect((await listShortcuts(db, group.id)).map((item) => item.order)).toEqual([0, 1]);
  });

  it('目标分组不存在时报错且记录留在原分组', async () => {
    const { second } = await addThree(group);

    await expect(moveShortcutToGroup(db, second.id, 'missing')).rejects.toThrowError(
      /目标分组不存在/,
    );

    const stored = await db.shortcuts.get(second.id);
    expect(stored?.groupId).toBe(group.id);
    expect(stored?.order).toBe(1);
  });

  it('移动到当前分组时原样返回', async () => {
    const { second } = await addThree(group);

    const result = await moveShortcutToGroup(db, second.id, group.id);

    expect(result.order).toBe(1);
  });
});
