import { describe, expect, it } from 'vitest';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import { childFolders, folderContentsStats, folderHomePathLabel, folderPathLabel, folderTrail,
  nearestExtantAncestor, sortFolders } from '@/features/folders/folder-path';
import { FOLDER_POSITION_LOCKED, folderPlacementConflict, movedHomeItem } from '@/features/folders/folder-placement';
import { folderBodyKind, folderReadDescription, type FolderShortcutRead } from '@/features/folders/folder-read';
import { canConfirmDelete, deleteFolderDescription, summarizeDelete } from '@/features/folders/folder-delete';

function folder(id: string, name: string, parentId: string | null, order = 0): Folder {
  return { id, name, parentId, order };
}

function shortcut(id: string, folderId: string | null, order = 0): Shortcut {
  return { id, folderId, title: id, url: `https://${id}.example.com`, icon: { kind: 'letter' }, iconSourceUrl: null, order };
}

/**
 * 四层文件夹树：
 *
 * 工作 / 项目 / 归档 / 深层
 * 另有顶层同名「项目」，与「工作 / 项目」名称相同但身份不同。
 */
const WORK = folder('work', '工作', null, 0);
const NESTED_PROJECT = folder('nested-project', '项目', 'work', 0);
const ARCHIVE = folder('archive', '归档', 'nested-project', 0);
const DEEP = folder('deep', '深层', 'archive', 0);
const ROOT_PROJECT = folder('root-project', '项目', null, 1);
const ORPHAN = folder('orphan', '孤儿', 'missing-parent', 0);

const FOLDERS = [WORK, NESTED_PROJECT, ARCHIVE, DEEP, ROOT_PROJECT, ORPHAN];
const SHORTCUTS = [
  shortcut('home-site', null, 0),
  shortcut('work-site', 'work', 0),
  shortcut('project-site', 'nested-project', 0),
  shortcut('archive-site-a', 'archive', 0),
  shortcut('archive-site-b', 'archive', 1),
  shortcut('deep-site', 'deep', 0),
];

describe('folderContentsStats 递归统计', () => {
  it('统计三层以上的全部后代文件夹与网站，不含自身文件夹记录', () => {
    // 工作直接挂 1 个网站；后代 项目/归档/深层 各挂 1、2、1 个网站。
    expect(folderContentsStats(FOLDERS, SHORTCUTS, WORK.id)).toEqual({ folders: 3, shortcuts: 5 });
    expect(folderContentsStats(FOLDERS, SHORTCUTS, NESTED_PROJECT.id)).toEqual({ folders: 2, shortcuts: 4 });
    expect(folderContentsStats(FOLDERS, SHORTCUTS, ARCHIVE.id)).toEqual({ folders: 1, shortcuts: 3 });
    expect(folderContentsStats(FOLDERS, SHORTCUTS, DEEP.id)).toEqual({ folders: 0, shortcuts: 1 });
  });

  it('只统计目标子树，其他顶层文件夹与主页网站不计入', () => {
    const stats = folderContentsStats(FOLDERS, SHORTCUTS, ROOT_PROJECT.id);
    expect(stats).toEqual({ folders: 0, shortcuts: 0 });
    expect(folderContentsStats(FOLDERS, SHORTCUTS, 'missing')).toEqual({ folders: 0, shortcuts: 0 });
  });

  it('父引用成环时不重复计数也不死循环', () => {
    const cyclic = [folder('a', 'A', 'b'), folder('b', 'B', 'a')];
    expect(folderContentsStats(cyclic, [shortcut('one', 'a'), shortcut('two', 'b')], 'a'))
      .toEqual({ folders: 1, shortcuts: 2 });
  });
});

describe('childFolders 与完整路径', () => {
  it('只按 parentId 取直接子文件夹，不按名称或路径前缀推断', () => {
    expect(childFolders(FOLDERS, WORK.id).map(({ id }) => id)).toEqual(['nested-project']);
    expect(childFolders(FOLDERS, ROOT_PROJECT.id)).toEqual([]);
    expect(childFolders(FOLDERS, ARCHIVE.id).map(({ id }) => id)).toEqual(['deep']);
  });

  it('同层按 order、再按 id 稳定排序', () => {
    const siblings = [folder('b', 'B', 'parent', 1), folder('a', 'A', 'parent', 1), folder('c', 'C', 'parent', 0)];
    expect(sortFolders(siblings).map(({ id }) => id)).toEqual(['c', 'a', 'b']);
    expect(childFolders([...siblings, folder('parent', '父', null)], 'parent').map(({ id }) => id))
      .toEqual(['c', 'a', 'b']);
  });

  it('同名文件夹用完整路径区分，不合并、不丢层级', () => {
    expect(folderPathLabel(FOLDERS, NESTED_PROJECT.id)).toBe('工作 / 项目');
    expect(folderPathLabel(FOLDERS, ROOT_PROJECT.id)).toBe('项目');
    expect(folderPathLabel(FOLDERS, DEEP.id)).toBe('工作 / 项目 / 归档 / 深层');
    expect(folderTrail(FOLDERS, DEEP.id).map(({ id }) => id)).toEqual(['work', 'nested-project', 'archive', 'deep']);
    expect(folderPathLabel(FOLDERS, 'missing')).toBe('未知文件夹');
  });

  it('父引用缺失时只给出仍可确认的一段，不猜测路径', () => {
    expect(folderTrail(FOLDERS, ORPHAN.id).map(({ id }) => id)).toEqual(['orphan']);
    expect(folderPathLabel(FOLDERS, ORPHAN.id)).toBe('孤儿');
  });
});

describe('nearestExtantAncestor 返回仍存在的最近祖先', () => {
  it('父文件夹仍存在时直接返回父层', () => {
    expect(nearestExtantAncestor(FOLDERS, ARCHIVE, [])).toBe('nested-project');
  });

  it('顶层文件夹没有祖先：调用方据此关闭弹层回到主页', () => {
    expect(nearestExtantAncestor(FOLDERS, WORK, [WORK])).toBeNull();
    // 删除当前层后同样走这一判定：父层还在就回到父层，父层也没了才关闭。
    expect(nearestExtantAncestor(FOLDERS, NESTED_PROJECT, [WORK, NESTED_PROJECT])).toBe('work');
  });

  it('父层已被删除时用会话记住的完整路径向上退到最近仍存在的祖先', () => {
    // 归档的父「项目」已在其他窗口被删：先按本次会话记住的路径回到「工作」。
    const withoutProject = FOLDERS.filter(({ id }) => id !== NESTED_PROJECT.id);
    expect(nearestExtantAncestor(withoutProject, ARCHIVE, [WORK, NESTED_PROJECT, ARCHIVE])).toBe('work');
  });

  it('记住的路径里有连续缺失时继续向上找，不停在第一条断链', () => {
    const withoutMiddle = FOLDERS.filter(({ id }) => id !== NESTED_PROJECT.id && id !== ARCHIVE.id);
    expect(nearestExtantAncestor(withoutMiddle, DEEP, [WORK, NESTED_PROJECT, ARCHIVE, DEEP])).toBe('work');
  });

  it('没有会话路径时沿残留父引用兜底，且遇到断链不猜测', () => {
    expect(nearestExtantAncestor(FOLDERS, DEEP, [])).toBe('archive');
    // 孤儿的父引用指向不存在的记录，没有可返回的祖先。
    expect(nearestExtantAncestor(FOLDERS, ORPHAN, [])).toBeNull();
    // 记住的路径本身也已过期时，仍不返回已删除节点。
    const withoutArchive = FOLDERS.filter(({ id }) => id !== ARCHIVE.id);
    expect(nearestExtantAncestor(withoutArchive, DEEP, [WORK, NESTED_PROJECT, ARCHIVE, DEEP])).toBe('nested-project');
  });

  it('父引用成环时终止并只返回仍存在的节点，不死循环', () => {
    const cyclic = [folder('a', 'A', 'b'), folder('b', 'B', 'a')];
    const result = nearestExtantAncestor(cyclic, cyclic[0]!, []);
    expect(result).toBe('b');
    expect(cyclic.some(({ id }) => id === result)).toBe(true);
  });
});

describe('folderPlacementConflict 固定文件夹守卫', () => {
  const placements = [
    { id: 'folder:work', row: 0, column: 0, height: 1 },
    { id: 'shortcut:a', row: 1, column: 0, height: 1 },
    { id: 'shortcut:b', row: 0, column: 1, height: 1 },
  ];

  it('文件夹自身可被放置判断放行（文件夹不提供移动入口）', () => {
    expect(folderPlacementConflict({ ...placements[0]!, row: 5, column: 1 }, placements)).toBeNull();
  });

  it('移动、跨列移动网站到文件夹格位都会拒绝并给出统一文案', () => {
    expect(folderPlacementConflict({ ...placements[1]!, row: 0 }, placements)).toBe(FOLDER_POSITION_LOCKED);
    expect(folderPlacementConflict({ ...placements[2]!, row: 0, column: 0 }, placements)).toBe(FOLDER_POSITION_LOCKED);
    // 菜单上移/下移同样走这个守卫：把同一列的网站推到文件夹格位也必须拒绝。
    expect(folderPlacementConflict({ ...placements[1]!, row: 0, column: 0 }, placements)).toBe(FOLDER_POSITION_LOCKED);
  });

  it('不碰撞的移动与另一列文件夹不受影响', () => {
    expect(folderPlacementConflict({ ...placements[1]!, row: 3 }, placements)).toBeNull();
    expect(folderPlacementConflict({ ...placements[1]!, row: 1, column: 1 }, placements)).toBeNull();
    expect(folderPlacementConflict({ ...placements[0]!, row: 0 }, placements)).toBeNull();
  });

  it('小组件改高挤到文件夹格位时拒绝，未挤到时放行', () => {
    const resized = [
      { id: 'folder:work', row: 2, column: 0, height: 1 },
      { id: 'folder:other', row: 5, column: 1, height: 1 },
      { id: 'widget:note', row: 0, column: 0, height: 2 },
    ];
    expect(folderPlacementConflict({ ...resized[2]!, height: 2 }, resized)).toBeNull();
    expect(folderPlacementConflict({ ...resized[2]!, height: 3 }, resized)).toBe(FOLDER_POSITION_LOCKED);
    // 只在同列下推：把第 1 列的小组件改高不会挤开第 2 列的文件夹。
    expect(folderPlacementConflict({ id: 'widget:note', row: 0, column: 1, height: 3 }, resized)).toBeNull();
  });
});

describe('movedHomeItem 菜单上移/下移与固定文件夹', () => {
  // 无文件夹时只按相邻行移动。
  const free = [
    { id: 'shortcut:a', row: 0, column: 0, height: 1 },
    { id: 'shortcut:b', row: 1, column: 0, height: 1 },
  ];
  // 文件夹固定在 1:0；同列有 above 0:0、below 3:0，另一列有 side 0:1。
  const fixed = [
    { id: 'folder:work', row: 1, column: 0, height: 1 },
    { id: 'shortcut:above', row: 0, column: 0, height: 1 },
    { id: 'shortcut:below', row: 3, column: 0, height: 1 },
    { id: 'shortcut:below-close', row: 2, column: 0, height: 1 },
    { id: 'shortcut:side', row: 0, column: 1, height: 1 },
  ];

  it('无文件夹时上移/下移只取相邻行，不被误拒', () => {
    expect(movedHomeItem(free[0]!, 'down', free)).toEqual({ ok: true,
      placement: { ...free[0]!, row: 1 } });
    expect(movedHomeItem(free[1]!, 'up', free)).toEqual({ ok: true,
      placement: { ...free[1]!, row: 0 } });
    expect(movedHomeItem(free[1]!, 'down', free)).toEqual({ ok: true,
      placement: { ...free[1]!, row: 2 } });
  });

  it('在顶行再上移停在原行，不产生负坐标也不报错', () => {
    expect(movedHomeItem(free[0]!, 'up', free)).toEqual({ ok: true, placement: free[0] });
  });

  it('菜单下移/上移到文件夹格位被拒绝，不把固定文件夹挤走', () => {
    expect(movedHomeItem(fixed[1]!, 'down', fixed))
      .toEqual({ ok: false, reason: FOLDER_POSITION_LOCKED });
    expect(movedHomeItem(fixed[3]!, 'up', fixed))
      .toEqual({ ok: false, reason: FOLDER_POSITION_LOCKED });
  });

  it('同列但离开文件夹方向、或另一列的菜单移动照常放行', () => {
    expect(movedHomeItem(fixed[1]!, 'up', fixed)).toEqual({ ok: true, placement: fixed[1] });
    expect(movedHomeItem(fixed[4]!, 'down', fixed)).toEqual({ ok: true,
      placement: { ...fixed[4]!, row: 1 } });
  });
});

describe('folderHomePathLabel 弹层路径从主页起算', () => {
  it('顶层与深层都显式带上「主页」起点', () => {
    expect(folderHomePathLabel(FOLDERS, WORK.id)).toBe('主页 / 工作');
    expect(folderHomePathLabel(FOLDERS, NESTED_PROJECT.id)).toBe('主页 / 工作 / 项目');
    expect(folderHomePathLabel(FOLDERS, DEEP.id)).toBe('主页 / 工作 / 项目 / 归档 / 深层');
  });

  it('父引用缺失时只追加仍可确认的一段，不伪造层级', () => {
    expect(folderHomePathLabel(FOLDERS, ORPHAN.id)).toBe('主页 / 孤儿');
    // 调用方只对存在的文件夹渲染该文案；标识不存在时没有可确认的层级，只剩主页。
    expect(folderHomePathLabel(FOLDERS, 'missing')).toBe('主页');
  });

  it('不改动移动菜单与重命名说明使用的不含主页路径', () => {
    expect(folderPathLabel(FOLDERS, NESTED_PROJECT.id)).toBe('工作 / 项目');
    expect(folderPathLabel(FOLDERS, ROOT_PROJECT.id)).toBe('项目');
  });
});

describe('DeleteFolderDialog 统计失败与重试', () => {
  it('统计成功时给出递归数量、直接提升范围与「不级联」说明', () => {
    const summary = summarizeDelete(FOLDERS, SHORTCUTS, NESTED_PROJECT.id);
    expect(summary).toEqual({ folders: 2, shortcuts: 4, childFolders: 1, directShortcuts: 1 });
    const text = deleteFolderDescription({
      name: '项目', target: '上一级文件夹', summary, statsError: null,
    });
    expect(text).toContain('不会连带删除里面的内容');
    expect(text).toContain('它直接的 1 个网站和 1 个子文件夹');
    expect(text).toContain('按原相对顺序追加到上一级文件夹已有内容之后');
    expect(text).toContain('更深层的 1 个子文件夹和 3 个网站继续留在各自所属的子文件夹里');
    expect(text).toContain('原有内容不移动');
    expect(text).not.toContain('正在统计');
    expect(text).not.toContain('统计失败');
  });

  it('顶层文件夹的说明目标仍是主页', () => {
    const summary = summarizeDelete(FOLDERS, SHORTCUTS, WORK.id);
    expect(summary).toEqual({ folders: 3, shortcuts: 5, childFolders: 1, directShortcuts: 1 });
    const text = deleteFolderDescription({ name: '工作', target: '主页', summary, statsError: null });
    expect(text).toContain('按原相对顺序追加到主页已有内容之后');
  });

  it('统计进行中显示统计数据进度，不显示失败', () => {
    const text = deleteFolderDescription({ name: '项目', target: '上一级文件夹', summary: null, statsError: null });
    expect(text).toBe('正在统计文件夹内容…');
  });

  it('统计失败明确写「统计失败」而不显示正在统计的假进度', () => {
    const text = deleteFolderDescription({ name: '项目', target: '上一级文件夹', summary: null,
      statsError: 'IndexedDB failed' });
    expect(text).toContain('统计失败');
    expect(text).toContain('无法确认删除范围');
    expect(text).not.toContain('正在统计');
    expect(text).not.toContain('不会连带删除里面的内容');
  });

  it('统计失败不沿用旧 summary：文案不会给出过期计数', () => {
    const stale = summarizeDelete(FOLDERS, SHORTCUTS, NESTED_PROJECT.id);
    // 重试失败时调用方把 summary 清空并写入错误，两者不会同时存在。
    const text = deleteFolderDescription({ name: '项目', target: '上一级文件夹', summary: null,
      statsError: 'IndexedDB failed' });
    expect(stale.directShortcuts).toBe(1);
    expect(text).not.toContain('1 个网站');
  });

  it('只有拿到统计结果才允许删除（失败态一律为不可确认）', () => {
    expect(canConfirmDelete({ summary: null, busy: false, statsError: null })).toBe(false);
    expect(canConfirmDelete({ summary: null, busy: false, statsError: 'IndexedDB failed' })).toBe(false);
    const summary = summarizeDelete(FOLDERS, SHORTCUTS, ARCHIVE.id);
    expect(canConfirmDelete({ summary, busy: false, statsError: null })).toBe(true);
    expect(canConfirmDelete({ summary, busy: true, statsError: null })).toBe(false);
  });
});

describe('FolderDialog 读取状态不把失败伪装成空文件夹', () => {
  const ready = (shortcuts: Shortcut[]): FolderShortcutRead => ({ status: 'ready', shortcuts });
  const states: readonly FolderShortcutRead[] = [
    { status: 'idle' },
    { status: 'loading' },
    { status: 'error', message: 'IndexedDB failed' },
  ];

  it('加载与失败都占用内容区，只有成功且真正为空才算空文件夹', () => {
    expect(folderBodyKind({ status: 'idle' }, 0)).toBe('loading');
    expect(folderBodyKind({ status: 'loading' }, 2)).toBe('loading');
    expect(folderBodyKind({ status: 'error', message: 'IndexedDB failed' }, 2)).toBe('error');
    expect(folderBodyKind(ready([]), 0)).toBe('empty');
    expect(folderBodyKind(ready([]), 2)).toBe('content');
    expect(folderBodyKind(ready([shortcut('one', 'work')]), 0)).toBe('content');
  });

  it('加载与失败的说明给出文件夹数量但不冒充 0 个网站', () => {
    for (const state of states) {
      const text = folderReadDescription(state, 2);
      expect(text).toContain('2 个文件夹');
      expect(text).not.toContain('0 个网站');
    }
    expect(folderReadDescription({ status: 'loading' }, 2)).toContain('正在读取网站…');
    expect(folderReadDescription({ status: 'error', message: 'IndexedDB failed' }, 2)).toContain('网站读取失败');
  });

  it('读取成功后同时给出网站与文件夹计数', () => {
    expect(folderReadDescription(ready([shortcut('one', 'work')]), 2)).toBe('1 个网站 · 2 个文件夹');
    expect(folderReadDescription(ready([]), 0)).toBe('0 个网站 · 0 个文件夹');
  });
});
