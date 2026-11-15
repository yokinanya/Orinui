import { legacyWireSettings, register, snapshot } from './snapshot-fixture';
import { expect, it } from 'vitest';
import { createDefaultAppearance } from '@/domain/appearance';
import { DEFAULT_LAYOUT } from '@/domain/layout';
import { createDefaultSettings } from '@/domain/settings';
import { shortcutIconOccupancy } from '@/domain/shortcut-icon';
import { LEGACY_FLAT_FOLDER_SYNC_SCHEMA_VERSION, LEGACY_HOME_SYNC_SCHEMA_VERSION, LEGACY_LAYOUT_SYNC_SCHEMA_VERSION,
  LEGACY_STYLE_SYNC_SCHEMA_VERSION, LEGACY_SYNC_SCHEMA_VERSION, mergeSyncSnapshots,
  materializeSyncSnapshot, parseSyncSnapshot, PREVIOUS_SYNC_SCHEMA_VERSION, SyncMergeConflictError,
  SYNC_SCHEMA_VERSION } from '@/domain/sync';
import type { SyncSnapshot } from '@/domain/sync';

function shortcut(input: { readonly title: string; readonly url: string; readonly deviceId: string; readonly clock: number;
  readonly folderId?: string | null }) {
  const { title, url, deviceId, clock, folderId = null } = input;
  return { id: 'shortcut-1', title: register(title, clock, deviceId), url: register(url, clock, deviceId),
    placement: register({ folderId, order: 0 }, clock, deviceId),
    icon: register({ kind: 'letter' } as const, clock, deviceId) };
}

function expectMergeConflict(action: () => unknown, code: string, entityId: string): void {
  let conflict: unknown;
  try { action(); } catch (error) { conflict = error; }
  expect(conflict).toBeInstanceOf(SyncMergeConflictError);
  expect(conflict).toMatchObject({ code, entityId });
}

function position(parentId: string | null, order: number, clock = 1, deviceId = 'device-a') {
  return register({ parentId, order }, clock, deviceId);
}

it('merges independent shortcut fields while same-field conflicts use clock then device id', () => {
  const local = snapshot('device-a', { shortcuts: [{ ...shortcut({ title: 'Local title', url: 'https://example.test/', deviceId: 'device-a', clock: 4 }),
    url: register('https://example.test/', 1, 'device-a') }] });
  const remote = snapshot('device-b', { shortcuts: [{ ...shortcut({ title: 'Title', url: 'https://remote.test/', deviceId: 'device-b', clock: 4 }),
    title: register('Title', 1, 'device-b') }] });
  const merged = mergeSyncSnapshots({ local, remotes: [remote] });
  const [record] = merged.shortcuts;
  if (!record) throw new Error('合并结果缺少网站记录');
  expect(record.title.value).toBe('Local title');
  expect(record.url.value).toBe('https://remote.test/');
  expect(materializeSyncSnapshot(merged).shortcuts[0]).toMatchObject({ title: 'Local title', url: 'https://remote.test/' });
  const tied = mergeSyncSnapshots({ local, remotes: [snapshot('device-z', { shortcuts: [shortcut({ title: 'Later device', url: 'https://later.test/', deviceId: 'device-z', clock: 4 })] })] });
  expect(tied.shortcuts[0]?.title.value).toBe('Later device');
});

it('rejects the pre-beta sync schema without migrating it', () => {
  const current = snapshot('device-a');
  expect(() => parseSyncSnapshot({ ...current, schemaVersion: 1 })).toThrow(/版本不受支持/);
  expect(() => parseSyncSnapshot({ ...current, schemaVersion: 2 })).toThrow(/版本不受支持/);
  expect(() => parseSyncSnapshot({ ...current, schemaVersion: 3 })).toThrow(/版本不受支持/);
});

it.each([4, 5, 6, 7, 8, 9])('rejects legacy group sync schema %s without remote mutation', (schemaVersion) => {
  const current = snapshot('device-a');
  const legacyEnvelope = { ...current, schemaVersion,
    defaultGroupId: register('legacy-default'),
    groups: [{ id: 'legacy-default', name: register('常用'), colorRole: register('primary'), position: register(0) }],
    folders: undefined,
  };
  expect(() => parseSyncSnapshot(legacyEnvelope)).toThrow(/旧分组同步协议|字段不正确/);
});

it('accepts the current folder schema and validates folder references', () => {
  const folder = { id: 'work', name: register('工作'), position: position(null, 0) };
  const site = shortcut({ title: '文档', url: 'https://example.test/', deviceId: 'device-a', clock: 1, folderId: folder.id });
  const parsed = parseSyncSnapshot(snapshot('device-a', { folders: [folder], shortcuts: [site] }));
  expect(parsed.folders).toEqual([folder]);
  expect(parsed.shortcuts[0]?.placement.value.folderId).toBe(folder.id);
});

it.each([4, 5, 6, 7, 8, 9])('rejects old group or intermediate wire schema %s', (schemaVersion) => {
  const legacy = { ...snapshot('device-a'), schemaVersion, defaultGroupId: register('legacy'),
    groups: [{ id: 'legacy', name: register('常用'), colorRole: register('primary'), position: register(0) }] };
  expect(() => parseSyncSnapshot(legacy)).toThrow(/旧分组同步协议/);
});
it.each(['left-stack', 'split'] as const)('merges and materializes layout %s through the layout preference register', (style) => {
  const base = snapshot('device-a');
  const local = { ...base, settings: { ...base.settings,
    layoutPreferences: register({ ...base.settings.layoutPreferences.value, style }, 2, 'device-a') } };
  const remote = snapshot('device-b');
  const parsed = parseSyncSnapshot(local);
  expect(materializeSyncSnapshot(mergeSyncSnapshots({ local: parsed, remotes: [remote] })).settings.layout.style).toBe(style);
});

it('keeps layout order and visibility registers independent of each other', () => {
  const base = snapshot('device-a');
  const local = { ...base, settings: { ...base.settings,
    layoutOrder: register({ order: ['bookmarks', 'clock', 'search', 'shortcuts'] as const }, 5, 'device-a') } };
  const remote = snapshot('device-b', { settings: { ...snapshot('device-b').settings,
    layoutVisibility: register({ hidden: ['search'] as const }, 6, 'device-b') } });
  const layout = materializeSyncSnapshot(mergeSyncSnapshots({ local, remotes: [remote] })).settings.layout;
  expect(layout.order).toEqual(['bookmarks', 'clock', 'search', 'shortcuts']);
  expect(layout.hidden).toEqual(['search']);
});

it('appends the bookmarks slot once when upgrading an old three-slot sync snapshot', () => {
  const current = snapshot('device-a');
  const legacy = { ...current, schemaVersion: 13, settings: { ...legacyWireSettings(current.settings),
    layout: { value: { order: ['shortcuts', 'clock', 'search'], hidden: ['clock'], style: 'split',
      clockPosition: 'right', pageWidth: 'wide', regionSpacing: 'relaxed', columns: 8 }, clock: 9, deviceId: 'device-a' } } };
  const parsed = parseSyncSnapshot(legacy);
  expect(parsed.settings.layoutOrder).toEqual({ value: { order: ['shortcuts', 'clock', 'search', 'bookmarks'] },
    clock: 9, deviceId: 'device-a' });
  expect(parsed.settings.layoutVisibility.value.hidden).toEqual(['clock']);
  expect(parsed.settings.bookmarksEnabled).toEqual({ value: false, clock: 0, deviceId: 'device-a' });
  expect(parsed.settings.bookmarkRules).toEqual({});
});

/** HEAD 9ddf706 的 schema 13 home 形状：字段路径 JSON 字符串 → {value,clock,deviceId}。 */
function schema13Home() {
  const field = (value: unknown, clock = 3, deviceId = 'device-b') => ({ value, clock, deviceId });
  return {
    [JSON.stringify(['placement', 'folder:work'])]: field({ id: 'folder:work', column: 1, row: 0, height: 1 }),
    [JSON.stringify(['placement', 'shortcut:s1'])]: field({ id: 'shortcut:s1', column: 0, row: 1, height: 1 }),
    [JSON.stringify(['placement', 'widget:note'])]: field({ id: 'widget:note', column: 0, row: 0, height: 2 }),
    [JSON.stringify(['placement', 'widget:todo'])]: field({ id: 'widget:todo', column: 1, row: 2, height: 3 }),
    [JSON.stringify(['widget', 'note', 'kind'])]: field('note'),
    [JSON.stringify(['widget', 'note', 'text'])]: field('便签正文'),
    [JSON.stringify(['widget', 'todo', 'kind'])]: field('todo'),
    [JSON.stringify(['widget', 'todo', 'text'])]: field(''),
    [JSON.stringify(['todo', 'todo', 't1', 'text'])]: field('第一项'),
    [JSON.stringify(['todo', 'todo', 't1', 'completed'])]: field(true),
    [JSON.stringify(['todo', 'todo', 't1', 'order'])]: field(0),
  };
}

/** 忠于 HEAD 的 schema 13 wire：数字文件夹位置、单块 layout、无书签寄存器，可选 home。 */
function schema13Snapshot(home?: Record<string, unknown>) {
  const current = snapshot('device-b');
  const settings: Record<string, unknown> = { ...legacyWireSettings(current.settings),
    // 退役的旧布局组合：升级时只回退 style/clockPosition/columns，不得连带丢弃 home。
    layout: { value: { order: ['shortcuts', 'clock', 'search'], hidden: ['clock'], style: 'split',
      clockPosition: 'right', pageWidth: 'wide', regionSpacing: 'relaxed', columns: 8 }, clock: 9, deviceId: 'device-b' },
    ...(home ? { home } : {}) };
  return { ...current, schemaVersion: LEGACY_FLAT_FOLDER_SYNC_SCHEMA_VERSION, settings,
    folders: [{ id: 'work', name: register('工作', 4, 'device-b'), position: register(0, 5, 'device-b') }],
    shortcuts: [{ ...shortcut({ title: '站点', url: 'https://example.test/', deviceId: 'device-b', clock: 2 }), id: 's1' }] };
}

it('keeps schema 13 settings.home registers instead of rejecting the real historical format', () => {
  const home = schema13Home();
  const parsed = parseSyncSnapshot(schema13Snapshot(home));
  // 字段内容、标识、位置与逻辑版本原样保留，不伪造编辑。
  expect(parsed.settings.home).toEqual(home);
  const materialized = materializeSyncSnapshot(parsed).settings.home;
  // validateHome 按行、列、ID 规范化排序；内容与逻辑版本仍原样保留。
  expect(materialized?.placements).toEqual([
    { id: 'widget:note', column: 0, row: 0, height: 2 },
    { id: 'folder:work', column: 1, row: 0, height: 1 },
    { id: 'shortcut:s1', column: 0, row: 1, height: 1 },
    { id: 'widget:todo', column: 1, row: 2, height: 3 },
  ]);
  expect(materialized?.widgets).toMatchObject([
    { id: 'note', kind: 'note', text: '便签正文', items: [] },
    { id: 'todo', kind: 'todo', items: [{ id: 't1', text: '第一项', completed: true, order: 0 }] },
  ]);
  // 旧布局迁移语义不变：只追加缺失区域、回退退役样式，既有顺序与显隐保留。
  expect(parsed.settings.layoutOrder.value.order).toEqual(['shortcuts', 'clock', 'search', 'bookmarks']);
  expect(parsed.settings.layoutVisibility.value.hidden).toEqual(['clock']);
  expect(parsed.settings.layoutPreferences.value.style).toBe('centered');
  expect(parsed.settings.layoutPreferences.value.columns).toBe(6);
  // 布局重置不牵连 home：字段逐条仍在，逻辑版本未被抬高。
  expect(parsed.settings.home).toEqual(home);
});

it('seeds home for a schema 12 snapshot without home and rejects one that carries it', () => {
  const current = snapshot('device-b');
  const schema12 = { ...current, schemaVersion: LEGACY_HOME_SYNC_SCHEMA_VERSION,
    settings: legacyWireSettings(current.settings),
    shortcuts: [{ ...shortcut({ title: '站点', url: 'https://example.test/', deviceId: 'device-b', clock: 2 }), id: 's1' }] };
  const seeded = parseSyncSnapshot(schema12);
  // schema 12 从未写出 home：按文件夹/主页网站顺序补零时钟寄存器。
  expect(Object.keys(seeded.settings.home ?? {})).toEqual([JSON.stringify(['placement', 'shortcut:s1'])]);
  expect(Object.values(seeded.settings.home ?? {}).every(({ clock }) => clock === 0)).toBe(true);
  expect(materializeSyncSnapshot(seeded).settings.home?.placements).toEqual([
    { id: 'shortcut:s1', column: 0, row: 0, height: 1 },
  ]);
  // schema 12 带 home 不是历史格式，仍拒绝，不因修复扩大兼容区间。
  expect(() => parseSyncSnapshot({ ...schema12, settings: { ...schema12.settings, home: schema13Home() } }))
    .toThrow(/同步设置字段不正确/);
});

it('still rejects malformed home, extra settings fields and invalid trees on the current schema', () => {
  const base = snapshot('device-a');
  const placement = { id: 'shortcut:x', column: 0, row: 0, height: 1 };
  const key = JSON.stringify(['placement', 'shortcut:x']);
  // 越界列：validatePlacement 拒绝，不会因放行 home 而放松格位规则。
  expect(() => parseSyncSnapshot({ ...base, settings: { ...base.settings,
    home: { [key]: register({ ...placement, column: 2 }) } } })).toThrow(/格位坐标不正确/);
  // 未知字段路径：字段标识白名单仍生效。
  expect(() => parseSyncSnapshot({ ...base, settings: { ...base.settings,
    home: { [JSON.stringify(['unknown', 'x'])]: register('x') } } })).toThrow(/未知主页同步字段/);
  // 寄存器缺 deviceId：逻辑版本形状仍严格校验。
  expect(() => parseSyncSnapshot({ ...base, settings: { ...base.settings,
    home: { [key]: { value: placement, clock: 1 } } } })).toThrow(/主页同步逻辑版本不正确/);
  // 当前 14 的设置键仍精确匹配。
  expect(() => parseSyncSnapshot({ ...base, settings: { ...base.settings, extra: register(true) } }))
    .toThrow(/同步设置字段不正确/);
  const cyclic = [{ id: 'a', name: register('A'), position: position('b', 0) },
    { id: 'b', name: register('B'), position: position('a', 0) }];
  expect(() => parseSyncSnapshot({ ...base, folders: cyclic })).toThrow(/成环/);
});

it('upgrades numeric folder positions to tree positions keeping the original stamp', () => {
  const current = snapshot('device-a');
  const legacy = { ...current, schemaVersion: 13, settings: legacyWireSettings(current.settings),
    folders: [{ id: 'work', name: register('工作', 4, 'device-b'), position: register(3, 7, 'device-b') }] };
  const parsed = parseSyncSnapshot(legacy);
  expect(parsed.folders).toEqual([{ id: 'work', name: register('工作', 4, 'device-b'),
    position: { value: { parentId: null, order: 3 }, clock: 7, deviceId: 'device-b' } }]);
});

it('rejects a folder parent cycle and a missing parent reference', () => {
  const current = snapshot('device-a');
  const cyclic = [{ id: 'a', name: register('A'), position: position('b', 0) },
    { id: 'b', name: register('B'), position: position('a', 0) }];
  expect(() => parseSyncSnapshot({ ...current, folders: cyclic })).toThrow(/成环/);
  const dangling = [{ id: 'a', name: register('A'), position: position('missing', 0) }];
  expect(() => parseSyncSnapshot({ ...current, folders: dangling })).toThrow(/父引用不存在/);
});

it('derives descendants of a deleted folder onto the closest surviving ancestor without rewriting registers', () => {
  const root = { id: 'root', name: register('根'), position: position(null, 0) };
  const child = { id: 'child', name: register('子'), position: position('root', 0) };
  const grandchild = { id: 'grand', name: register('孙'), position: position('child', 0) };
  const site = shortcut({ title: '站点', url: 'https://example.test/', deviceId: 'device-a', clock: 2, folderId: 'child' });
  const local = snapshot('device-a', { folders: [root, child, grandchild], shortcuts: [site] });
  const deleted = snapshot('device-b', { tombstones: [{ entityType: 'folder', id: 'child', clock: 9, deviceId: 'device-b' }] });
  const merged = mergeSyncSnapshots({ local, remotes: [deleted] });
  const materialized = materializeSyncSnapshot(merged);
  expect(materialized.folders).toEqual([
    { id: 'root', parentId: null, name: '根', order: 0 },
    { id: 'grand', parentId: 'root', name: '孙', order: 0 },
  ]);
  expect(merged.folders.find(({ id }) => id === 'grand')?.position).toEqual(grandchild.position);
  expect(materialized.shortcuts[0]?.folderId).toBe('root');
});

it('retains the deleted folder parent in the tombstone across serialize, parse and a second device', () => {
  const root = { id: 'root', name: register('根'), position: position(null, 0) };
  const child = { id: 'child', name: register('子'), position: position('root', 0) };
  const grandchild = { id: 'grand', name: register('孙'), position: position('child', 0) };
  const site = shortcut({ title: '站点', url: 'https://example.test/', deviceId: 'device-a', clock: 2, folderId: 'child' });
  const local = snapshot('device-a', { folders: [root, child, grandchild], shortcuts: [site] });
  const deleted = snapshot('device-b', { tombstones: [{ entityType: 'folder', id: 'child', clock: 9, deviceId: 'device-b' }] });
  const merged = mergeSyncSnapshots({ local, remotes: [deleted] });
  // 墓碑携带被删文件夹当时的父层引用，序列化往返后仍保留。
  expect(merged.tombstones.find(({ id }) => id === 'child')?.parentId).toBe('root');
  const wire = JSON.parse(JSON.stringify(merged));
  const reparsed = parseSyncSnapshot(wire);
  expect(reparsed.tombstones.find(({ id }) => id === 'child')?.parentId).toBe('root');
  expect(materializeSyncSnapshot(reparsed).folders.map(({ id, parentId }) => [id, parentId]))
    .toEqual([['root', null], ['grand', 'root']]);

  // 第二台设备只拿到 wire 快照也能重建同一祖先关系，不依赖本机历史。
  const second = snapshot('device-c');
  const joined = mergeSyncSnapshots({ local: second, remotes: [reparsed] });
  expect(joined.tombstones.find(({ id }) => id === 'child')?.parentId).toBe('root');
  expect(materializeSyncSnapshot(joined).folders.map(({ id, parentId }) => [id, parentId]))
    .toEqual([['root', null], ['grand', 'root']]);
});

it('walks multiple consecutive ancestor tombstones up to the closest survivor', () => {
  const root = { id: 'root', name: register('根'), position: position(null, 0) };
  const mid = { id: 'mid', name: register('中'), position: position('root', 0) };
  const leaf = { id: 'leaf', name: register('叶'), position: position('mid', 0) };
  const deep = { id: 'deep', name: register('深'), position: position('leaf', 0) };
  const local = snapshot('device-a', { folders: [root, mid, leaf, deep] });
  // 两级连续祖先墓碑：leaf 的父引用仍指向 mid，deep 仍指向 leaf。
  const deleted = snapshot('device-b', { tombstones: [
    { entityType: 'folder', id: 'mid', clock: 5, deviceId: 'device-b' },
    { entityType: 'folder', id: 'leaf', clock: 6, deviceId: 'device-b', parentId: 'mid' },
  ] });
  const merged = mergeSyncSnapshots({ local, remotes: [deleted] });
  expect(materializeSyncSnapshot(merged).folders.map(({ id, parentId }) => [id, parentId]))
    .toEqual([['root', null], ['deep', 'root']]);
  // 派生不伪装成编辑：deep 的寄存器 clock/deviceId 不变。
  expect(merged.folders.find(({ id }) => id === 'deep')?.position).toEqual(deep.position);
});

it('keeps a known folder parent when a higher-stamp tombstone omits it', () => {
  const root = { id: 'root', name: register('根'), position: position(null, 0) };
  const grandchild = { id: 'grand', name: register('孙'), position: position('child', 0) };
  const local = snapshot('device-a', { folders: [root, grandchild], tombstones: [
    { entityType: 'folder', id: 'child', clock: 3, deviceId: 'device-b', parentId: 'root' }] });
  const known = snapshot('device-b', { folders: [root], tombstones: [
    { entityType: 'folder', id: 'child', clock: 3, deviceId: 'device-b', parentId: 'root' }] });
  const legacy = snapshot('device-c', { folders: [root], tombstones: [
    { entityType: 'folder', id: 'child', clock: 9, deviceId: 'device-c' }] });

  // 被删文件夹的存活记录已不在任何输入里，无法再靠 live 记录补全祖先。
  const forward = mergeSyncSnapshots({ local, remotes: [known, legacy] });
  const backward = mergeSyncSnapshots({ local, remotes: [legacy, known] });
  // 较高逻辑版本胜出，但父层引用是已知事实：缺省不抹掉已确认的祖先。
  expect(forward.tombstones).toEqual([{ entityType: 'folder', id: 'child', clock: 9, deviceId: 'device-c', parentId: 'root' }]);
  expect(backward.tombstones).toEqual(forward.tombstones);
  // 祖先保留后后代回到 root；缺省会让它错误坠到主页。
  expect(materializeSyncSnapshot(forward).folders.map(({ id, parentId }) => [id, parentId]))
    .toEqual([['root', null], ['grand', 'root']]);
  expect(materializeSyncSnapshot(backward).folders.map(({ id, parentId }) => [id, parentId]))
    .toEqual([['root', null], ['grand', 'root']]);
});

it('does not treat a wire null tombstone parent as a conflicting known parent', () => {
  const root = { id: 'root', name: register('根'), position: position(null, 0) };
  const local = snapshot('device-a', { folders: [root] });
  const known = snapshot('device-b', { folders: [root], tombstones: [
    { entityType: 'folder', id: 'child', clock: 3, deviceId: 'device-b', parentId: 'root' }] });
  // wire 上的 `null` 是「没有元数据」的另一种写法，解析时规范化为缺省。
  const wire = { ...snapshot('device-c'), folders: [root] };
  const wireNull: unknown = { ...wire, tombstones: [
    { entityType: 'folder', id: 'child', clock: 3, deviceId: 'device-b', parentId: null }] };
  const merged = mergeSyncSnapshots({ local, remotes: [known, wireNull as SyncSnapshot] });
  expect(merged.tombstones).toEqual([{ entityType: 'folder', id: 'child', clock: 3, deviceId: 'device-b', parentId: 'root' }]);
});

it('rejects same-stamp folder tombstones that name different known parents', () => {
  const local = snapshot('device-a');
  const rootA = { id: 'root-a', name: register('根A'), position: position(null, 0) };
  const rootB = { id: 'root-b', name: register('根B'), position: position(null, 0) };
  const first = snapshot('device-b', { folders: [rootA], tombstones: [
    { entityType: 'folder', id: 'child', clock: 3, deviceId: 'device-b', parentId: 'root-a' }] });
  const second = snapshot('device-c', { folders: [rootB], tombstones: [
    { entityType: 'folder', id: 'child', clock: 3, deviceId: 'device-b', parentId: 'root-b' }] });
  expect(() => mergeSyncSnapshots({ local, remotes: [first, second] })).toThrow(/同一删除墓碑逻辑版本包含不同父文件夹/);
});

it('keeps target-layer order and appends promoted items after the existing maximum', () => {
  const root = { id: 'root', name: register('根'), position: position(null, 0) };
  const keep = { id: 'keep', name: register('保留'), position: position(null, 5) };
  const middle = { id: 'middle', name: register('中层'), position: position(null, 9) };
  const promotedA = { id: 'pa', name: register('升A'), position: position('middle', 3) };
  const promotedB = { id: 'pb', name: register('升B'), position: position('middle', 7) };
  const child = { id: 'child', name: register('子'), position: position('middle', 1) };
  const site = shortcut({ title: '中层站点', url: 'https://example.test/', deviceId: 'device-a', clock: 3, folderId: 'middle' });
  const local = snapshot('device-a', { folders: [root, keep, middle, promotedA, promotedB, child],
    shortcuts: [site] });
  const deleted = snapshot('device-b', { tombstones: [{ entityType: 'folder', id: 'middle', clock: 9, deviceId: 'device-b' }] });
  const materialized = materializeSyncSnapshot(mergeSyncSnapshots({ local, remotes: [deleted] }));

  // 目标层既有项 order 不变（0 与 5 均未重编号）；提升项按原相对顺序（1、3、7）追加到 max+1。
  expect(materialized.folders).toEqual([
    { id: 'root', parentId: null, name: '根', order: 0 },
    { id: 'keep', parentId: null, name: '保留', order: 5 },
    { id: 'child', parentId: null, name: '子', order: 6 },
    { id: 'pa', parentId: null, name: '升A', order: 7 },
    { id: 'pb', parentId: null, name: '升B', order: 8 },
  ]);
  // 网站落到主页，主页既有项的 order 也不重编号。
  expect(materialized.shortcuts).toEqual([expect.objectContaining({ id: site.id, folderId: null, order: 0 })]);
});

it('applies hidden rules per record with explicit unhide and a null deletion value', () => {
  const rule = { ruleId: 'r1', targetId: 'node-1', path: ['根', '文件夹'], kind: 'folder' as const,
    hidden: true, updatedAt: 100 };
  const local = snapshot('device-a', { settings: { ...snapshot('device-a').settings,
    bookmarkRules: { r1: register(rule, 5, 'device-a') } } });
  const remote = snapshot('device-b', { settings: { ...snapshot('device-b').settings,
    bookmarkRules: { r1: register({ ...rule, hidden: false, updatedAt: 200 }, 6, 'device-b'),
      r2: register({ ...rule, ruleId: 'r2', targetId: 'node-2' }, 4, 'device-b') } } });
  const materialized = materializeSyncSnapshot(mergeSyncSnapshots({ local, remotes: [remote] }));
  expect(materialized.settings.bookmarks).toMatchObject({ enabled: false, mode: 'region', showInSearch: true });
  expect(materialized.settings.bookmarks.hiddenRules).toEqual([
    { ...rule, hidden: false, updatedAt: 200 },
    { ...rule, ruleId: 'r2', targetId: 'node-2' },
  ]);
  const deleted = snapshot('device-c', { settings: { ...snapshot('device-c').settings,
    bookmarkRules: { r1: { value: null, clock: 7, deviceId: 'device-c' } } } });
  const merged = mergeSyncSnapshots({ local, remotes: [remote, deleted] });
  expect(materializeSyncSnapshot(merged).settings.bookmarks.hiddenRules.map(({ ruleId }) => ruleId)).toEqual(['r2']);
  expect(merged.settings.bookmarkRules.r1?.value).toBeNull();
});

it('resolves bookmark rule null as ordinary LWW across stamps regardless of merge order', () => {
  const rule = { ruleId: 'r1', targetId: 'node-1', path: ['根'], kind: 'root' as const, hidden: true, updatedAt: 100 };
  const deleted = snapshot('device-a', { settings: { ...snapshot('device-a').settings,
    bookmarkRules: { r1: register(null, 4, 'device-a') } } });
  const revived = snapshot('device-b', { settings: { ...snapshot('device-b').settings,
    bookmarkRules: { r1: register(rule, 9, 'device-b') } } });

  // 更高逻辑版本的值覆盖更旧的 null（不是 delete-wins），两种合并顺序结论一致。
  const forward = mergeSyncSnapshots({ local: deleted, remotes: [revived] });
  const backward = mergeSyncSnapshots({ local: revived, remotes: [deleted] });
  expect(forward.settings.bookmarkRules.r1).toEqual(register(rule, 9, 'device-b'));
  expect(backward.settings.bookmarkRules.r1).toEqual(forward.settings.bookmarkRules.r1);
  expect(materializeSyncSnapshot(forward).settings.bookmarks.hiddenRules.map(({ ruleId }) => ruleId)).toEqual(['r1']);
  expect(materializeSyncSnapshot(backward).settings.bookmarks.hiddenRules.map(({ ruleId }) => ruleId)).toEqual(['r1']);

  // 反向：更高逻辑版本的 null 也照常胜出。
  const newerDelete = snapshot('device-c', { settings: { ...snapshot('device-c').settings,
    bookmarkRules: { r1: register(null, 12, 'device-c') } } });
  const olderValue = snapshot('device-d', { settings: { ...snapshot('device-d').settings,
    bookmarkRules: { r1: register(rule, 2, 'device-d') } } });
  const merged = [mergeSyncSnapshots({ local: newerDelete, remotes: [olderValue] }),
    mergeSyncSnapshots({ local: olderValue, remotes: [newerDelete] })];
  for (const result of merged) {
    expect(result.settings.bookmarkRules.r1).toEqual(register(null, 12, 'device-c'));
    expect(materializeSyncSnapshot(result).settings.bookmarks.hiddenRules).toEqual([]);
  }
});

it('rejects a bookmark rule whose register key disagrees with its ruleId', () => {
  const base = snapshot('device-a');
  const rule = { ruleId: 'other', targetId: 'node', path: ['根'], kind: 'root' as const, hidden: true, updatedAt: 1 };
  expect(() => parseSyncSnapshot({ ...base, settings: { ...base.settings,
    bookmarkRules: { r1: register(rule) } } })).toThrow(/键与规则标识不一致/);
});

it('rejects same-stamp bookmark rule registers carrying different content', () => {
  const rule = { ruleId: 'r1', targetId: 'node', path: ['根'], kind: 'root' as const, hidden: true, updatedAt: 1 };
  const local = snapshot('device-a', { settings: { ...snapshot('device-a').settings,
    bookmarkRules: { r1: register(rule, 5, 'device-a') } } });
  const conflicting = snapshot('device-b', { settings: { ...snapshot('device-b').settings,
    bookmarkRules: { r1: register({ ...rule, hidden: false }, 5, 'device-a') } } });
  // 与其它寄存器一致：同 clock + 同 device 却内容不同是数据错误，不按遍历顺序静默选一个。
  expect(() => mergeSyncSnapshots({ local, remotes: [conflicting] })).toThrow(/同一隐藏规则逻辑版本包含不同内容/);
});

it('retains unselected background assets in the full synchronized library', () => {
  const wallpaper = { id: 'wallpaper-1', kind: 'background' as const, mime: 'image/png' as const,
    width: 1, height: 1, byteLength: 5, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const local = snapshot('device-a', { assets: [wallpaper] });
  expect(parseSyncSnapshot(local).assets).toEqual([wallpaper]);
  expect(mergeSyncSnapshots({ local, remotes: [] }).assets).toEqual([wallpaper]);
});

it('merges new preference registers independently', () => {
  const local = snapshot('device-a');
  const remote = snapshot('device-b', { settings: {
    ...snapshot('device-b').settings,
    searchPreferences: register({ width: 'wide', autoFocus: true, openTarget: 'new-tab' }, 5, 'device-b'),
    shortcutPreferences: register({ showNames: false, openTarget: 'new-tab' }, 6, 'device-b'),
  } });
  const merged = mergeSyncSnapshots({ local, remotes: [remote] });
  expect(materializeSyncSnapshot(merged).settings.search).toMatchObject({ width: 'wide', autoFocus: true, openTarget: 'new-tab' });
  expect(materializeSyncSnapshot(merged).settings.shortcuts).toEqual({ showNames: false, openTarget: 'new-tab' });
});

it('prefers an entity tombstone to a live replica and rejects the same tombstone beside a live entity', () => {
  const live = snapshot('device-a', { shortcuts: [shortcut({ title: 'Title', url: 'https://example.test/', deviceId: 'device-a', clock: 2 })] });
  const deleted = snapshot('device-b', { tombstones: [{ entityType: 'shortcut', id: 'shortcut-1', clock: 1, deviceId: 'device-b' }] });
  expect(mergeSyncSnapshots({ local: live, remotes: [deleted] }).shortcuts).toEqual([]);
  expect(() => parseSyncSnapshot({ ...live, tombstones: deleted.tombstones })).toThrow(/同时处于存活和删除状态/);
});

it('deleted folder moves an unchanged child to homepage without a shortcut tombstone', () => {
  const folder = { id: 'folder-extra', name: register('额外'), position: position(null, 1) };
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 2, folderId: folder.id });
  const local = snapshot('device-a', { folders: [folder], shortcuts: [child] });
  const deletedFolder = snapshot('device-b', {
    tombstones: [{ entityType: 'folder', id: folder.id, clock: 3, deviceId: 'device-b' }],
  });
  const result = mergeSyncSnapshots({ local, remotes: [deletedFolder] });

  expect(result.folders).toEqual([]);
  expect(result.shortcuts).toHaveLength(1);
  expect(result.shortcuts[0]?.placement).toEqual(child.placement);
  expect(materializeSyncSnapshot(result).shortcuts[0]?.folderId).toBeNull();
  expect(result.tombstones).toContainEqual(expect.objectContaining({ entityType: 'folder', id: folder.id }));
  expect(result.tombstones).not.toContainEqual(expect.objectContaining({ entityType: 'shortcut', id: child.id }));
});

it('permanent folder deletion wins even a newer placement without rewriting the register', () => {
  const folder = { id: 'folder-extra', name: register('额外'), position: position(null, 1) };
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 8, folderId: folder.id });
  const local = snapshot('device-a', { folders: [folder], shortcuts: [child] });
  const deletedFolder = snapshot('device-b', {
    tombstones: [{ entityType: 'folder', id: folder.id, clock: 3, deviceId: 'device-b' }],
  });
  const result = mergeSyncSnapshots({ local, remotes: [deletedFolder] });

  expect(result.folders).toEqual([]);
  expect(result.shortcuts[0]?.placement).toEqual(child.placement);
  expect(materializeSyncSnapshot(result).shortcuts[0]?.folderId).toBeNull();
  expect(result.tombstones).toContainEqual(expect.objectContaining({ entityType: 'folder', id: folder.id }));
});

it('moving a child to homepage wins a newer folder tombstone', () => {
  const folder = { id: 'folder-extra', name: register('额外'), position: position(null, 1) };
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 2, folderId: folder.id });
  const local = snapshot('device-a', { folders: [folder], shortcuts: [child] });
  const deletedFolder = snapshot('device-b', {
    tombstones: [{ entityType: 'folder', id: folder.id, clock: 3, deviceId: 'device-b' }],
  });
  const moved = snapshot('device-c', { shortcuts: [{ ...child,
    placement: register({ folderId: null, order: 0 }, 4, 'device-c') }] });
  const result = mergeSyncSnapshots({ local, remotes: [deletedFolder, moved] });

  expect(result.folders).toEqual([]);
  expect(result.shortcuts[0]?.placement.value.folderId).toBeNull();
});

it('keeps same-layer register order and resolves ties by id without renaming registers', () => {
  const folders = [
    { id: 'g2', name: register('二'), position: position(null, 0, 2, 'device-b') },
    { id: 'folder-default', name: register('常用'), position: position(null, 0) },
  ];
  const merged = mergeSyncSnapshots({ local: snapshot('device-a', { folders }), remotes: [] });
  // 同层同 order 是两台设备各自新建的合法结果：不重编号、不伪造编辑，按 id 稳定决胜。
  expect(materializeSyncSnapshot(merged).folders.map(({ id, order }) => [id, order]))
    .toEqual([['folder-default', 0], ['g2', 0]]);
  expect(merged.folders.find(({ id }) => id === 'g2')?.position.clock).toBe(2);
  expect(merged.folders.find(({ id }) => id === 'folder-default')?.position.clock).toBe(1);
});

it('rejects removed group wire schemas, unknown versions and malformed references', () => {
  const valid = snapshot('device-a');
  expect(() => parseSyncSnapshot({ ...valid, schemaVersion: SYNC_SCHEMA_VERSION + 1 })).toThrow(/版本不受支持/);
  expect(() => parseSyncSnapshot({ ...valid, schemaVersion: 4 })).toThrow(/旧分组同步协议/);
  expect(() => parseSyncSnapshot({ ...valid, schemaVersion: 9 })).toThrow(/旧分组同步协议/);
  expect(() => parseSyncSnapshot({ ...valid, extra: true })).toThrow(/字段不正确/);
  const folderId = (value: string) => ({ ...shortcut({ title: 'Title', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    placement: register({ folderId: value, order: 0 }) });
  expect(() => parseSyncSnapshot({ ...valid, shortcuts: [folderId('missing')] }))
    .toThrow(/所属文件夹引用不存在/);
  const folders = Array.from({ length: 51 }, (_, index) => ({ id: `folder-${index}`, name: register(`文件夹${index}`),
    position: position(null, index) }));
  expect(() => parseSyncSnapshot({ ...valid, folders })).toThrow(/文件夹数量超限/);
});

it('rejects conflicting immutable metadata for the same asset id', () => {
  const asset = { id: 'asset-1', kind: 'icon' as const, mime: 'image/png' as const, width: 64, height: 64,
    byteLength: 100, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const local = snapshot('device-a', { assets: [asset], shortcuts: [{ ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'asset-1' }) }] });
  const remote = snapshot('device-b', { assets: [{ ...asset, sha256: 'b'.repeat(64) }], shortcuts: local.shortcuts });
  expect(() => mergeSyncSnapshots({ local, remotes: [remote] })).toThrow(/对应不同内容/);
});

it('validates motion metadata and requires motion backgrounds to reference dynamic media', () => {
  const dynamic = { id: 'video-1', kind: 'background' as const, mime: 'video/mp4' as const, width: 1920, height: 1080,
    byteLength: 80 * 1024 * 1024, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null),
    motion: { kind: 'video' as const, duration: 8 } };
  const base = snapshot('device-a');
  const withMotion = { ...base,
    settings: { ...base.settings, appearance: register({ ...createDefaultAppearance(),
      background: { kind: 'motion' as const, assetId: dynamic.id, maskStrength: 0.55 } }) },
    assets: [dynamic] };
  expect(parseSyncSnapshot(withMotion).assets[0]?.motion).toEqual({ kind: 'video', duration: 8 });
  expect(() => parseSyncSnapshot({ ...withMotion, assets: [{ ...dynamic, motion: null }] }))
    .toThrow(/动态媒体缺少动态元数据/);
  expect(() => parseSyncSnapshot({ ...withMotion, settings: { ...withMotion.settings,
    appearance: register({ ...createDefaultAppearance(),
      background: { kind: 'photo' as const, assetId: dynamic.id, maskStrength: 0.55 } }) } }))
    .toThrow(/背景类型与媒体动态属性不匹配/);
  expect(() => parseSyncSnapshot({ ...withMotion, assets: [{ ...dynamic, motion: { ...dynamic.motion, poster: 'not allowed' } }] }))
    .toThrow(/字段不正确/);
});

it('rejects absent media references and accepts large assets without a total cap', () => {
  const missingImage = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'missing' }) };
  expect(() => parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [missingImage] })).toThrow(/图标资源引用不存在/);
  const asset = { id: 'asset-1', kind: 'icon' as const, mime: 'image/png' as const, width: 64, height: 64,
    byteLength: 80 * 1024 * 1024, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const shortcutWithAsset = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: 'asset-1' }) };
  expect(parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [shortcutWithAsset], assets: [asset] }).assets).toHaveLength(1);
});

it('accepts SVG icon colors only for SVG icon assets in snapshots', () => {
  const asset = { id: 'svg-1', kind: 'icon' as const, mime: 'image/svg+xml' as const, width: 512, height: 512,
    byteLength: 20, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const shortcutWithSvg = { ...shortcut({ title: 'SVG', url: 'https://svg.example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: asset.id, color: '#12abef', occupancy: 75 }) };
  const restoredIcon = parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [shortcutWithSvg], assets: [asset] })
    .shortcuts[0]?.icon.value;
  expect(restoredIcon).toMatchObject({ color: '#12abef' });
  expect(shortcutIconOccupancy(restoredIcon!)).toBe(75);
  const legacyShortcut = { ...shortcut({ title: '旧同步', url: 'https://old-svg.example.test/', deviceId: 'device-a', clock: 2 }),
    icon: register({ kind: 'asset' as const, assetId: asset.id, size: 32 }) };
  expect(parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [legacyShortcut], assets: [asset] })
    .shortcuts[0]?.icon.value).toMatchObject({ occupancy: 67 });
  expect(() => parseSyncSnapshot({ ...snapshot('device-a'), shortcuts: [shortcutWithSvg],
    assets: [{ ...asset, mime: 'image/png' }] })).toThrow(/只能用于 SVG/);
  expect(() => parseSyncSnapshot({ ...snapshot('device-a'), assets: [{ ...asset, kind: 'background' }] }))
    .toThrow(/SVG 不能作为背景/);
});

it('reports a typed conflict when a concurrently deleted custom engine remains selected', () => {
  const engine = { id: 'engine-e', name: 'Engine E', template: 'https://search.test/?q={query}', builtIn: false };
  const local = snapshot('device-a', { settings: {
    ...snapshot('device-a').settings, defaultEngineId: register(engine.id, 8, 'device-a'),
    customEngines: [register(engine, 2, 'device-a')],
  } });
  const remote = snapshot('device-b', { tombstones: [{ entityType: 'custom-engine', id: engine.id, clock: 9, deviceId: 'device-b' }] });

  expectMergeConflict(() => mergeSyncSnapshots({ local, remotes: [remote] }), 'custom-engine-deleted-while-default', engine.id);
});

it('reports a typed conflict when a concurrently deleted asset remains referenced', () => {
  const asset = { id: 'asset-e', kind: 'icon' as const, mime: 'image/png' as const, width: 64, height: 64,
    byteLength: 100, sha256: 'a'.repeat(64), sourceUrl: register(null), name: register(null), motion: null };
  const shortcutWithAsset = { ...shortcut({ title: 'Icon', url: 'https://example.test/', deviceId: 'device-a', clock: 1 }),
    icon: register({ kind: 'asset' as const, assetId: asset.id }) };
  const local = snapshot('device-a', { shortcuts: [shortcutWithAsset], assets: [asset] });
  const remote = snapshot('device-b', { tombstones: [{ entityType: 'asset', id: asset.id, clock: 2, deviceId: 'device-b' }] });

  expectMergeConflict(() => mergeSyncSnapshots({ local, remotes: [remote] }), 'asset-deleted-while-referenced', asset.id);
});

it('requires a permanent folder tombstone for a dangling placement', () => {
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 8, folderId: 'deleted-folder' });
  const input = snapshot('device-a', { shortcuts: [child] });
  expect(() => parseSyncSnapshot(input)).toThrow(/文件夹引用不存在/);
  const deleted = { ...input, tombstones: [{ entityType: 'folder' as const, id: 'deleted-folder', clock: 1, deviceId: 'device-b' }] };
  expect(parseSyncSnapshot(deleted).shortcuts[0]?.placement).toEqual(child.placement);
  expect(materializeSyncSnapshot(deleted).shortcuts[0]?.folderId).toBeNull();
});

it('converges after remerging a deleted-folder projection with an offline live replica', () => {
  const folder = { id: 'gone', name: register('工作'), position: position(null, 0) };
  const child = shortcut({ title: 'Child', url: 'https://child.test/', deviceId: 'device-a', clock: 8, folderId: folder.id });
  const offline = snapshot('device-a', { folders: [folder], shortcuts: [child] });
  const deleted = snapshot('device-b', { tombstones: [{ entityType: 'folder', id: folder.id, clock: 2, deviceId: 'device-b' }] });
  const first = mergeSyncSnapshots({ local: offline, remotes: [deleted] });
  const repeated = mergeSyncSnapshots({ local: first, remotes: [offline, deleted] });
  expect(repeated).toEqual(first);
  expect(repeated.shortcuts[0]?.placement).toEqual(child.placement);
  expect(repeated.folders).toEqual([]);
  expect(materializeSyncSnapshot(repeated).shortcuts[0]?.folderId).toBeNull();
});
