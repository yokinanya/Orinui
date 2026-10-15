import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createGroup, deleteGroup, renameGroup } from '@/storage/groups';
import { createShortcut, deleteShortcut, restoreShortcut, updateShortcut } from '@/storage/shortcuts';
import { createImageAsset } from '@/storage/assets';
import { readSettings, updateSettings } from '@/storage/settings';
import { finalizePendingDeletes, seedSyncRecords } from '@/storage/sync';
import type { SyncStateRow } from '@/storage/sync/types';

let db: Database;
let now: number;
let defaultGroupId: string;
const image = () => ({ kind: 'icon' as const, mime: 'image/png' as const, width: 10, height: 10,
  blob: new Blob(['pixels'], { type: 'image/png' }), sourceUrl: 'https://images.example/icon.png' });

async function enableSync(): Promise<SyncStateRow> {
  const state: SyncStateRow = { id: 'app', vaultId: 'vault-1', deviceId: 'device-1', clock: 0, generation: 0,
    defaultGroupId: { value: defaultGroupId, clock: 0, deviceId: 'device-1' }, suspended: false };
  await db.sync_state.put(state);
  return seedSyncRecords(db);
}

beforeEach(async () => {
  now = 1_000_000;
  db = createDatabase(`sync-capture-${crypto.randomUUID()}`, { now: () => now });
  defaultGroupId = (await ensureInitialized(db)).defaultGroup.id;
});
afterEach(async () => { db.close(); await db.delete(); });

describe('未启用及原子提交', () => {
  it('同步未启用时普通写入不产生同步记录', async () => {
    await createGroup(db, '工作');
    await createShortcut(db, { groupId: defaultGroupId, title: '文档', url: 'example.com' });
    expect(await db.sync_state.count()).toBe(0);
    expect(await db.sync_records.count()).toBe(0);
  });

  it('同一业务事务回滚时同步记录与时钟一起回滚', async () => {
    const state = await enableSync();
    const before = await db.sync_records.toArray();
    await expect(db.transaction('rw', db.groups, db.sync_state, db.sync_records, async () => {
      await renameGroup(db, defaultGroupId, '临时名称');
      throw new Error('force rollback');
    })).rejects.toThrow('force rollback');
    expect((await db.groups.get(defaultGroupId))?.name).toBe('常用');
    expect(await db.sync_records.toArray()).toEqual(before);
    expect(await db.sync_state.get('app')).toEqual(state);
  });
});

describe('字段版本捕获：个性化设置', () => {
  it('独立捕获个性化寄存器，并在业务事务回滚时一并回滚', async () => {
    const state = await enableSync();
    const beforeRecord = await db.sync_records.get('settings:app');
    const beforeSettings = await readSettings(db);
    if (beforeRecord?.kind !== 'settings') throw new Error('同步设置记录缺失');

    await expect(db.transaction('rw', [db.settings, db.sync_state, db.sync_records], async () => {
      await updateSettings(db, (current) => ({
        ...current,
        clock: { ...current.clock, weekdayFormat: 'english-short' },
        search: { ...current.search, width: 'wide', autoFocus: true },
        shortcuts: { ...current.shortcuts, showNames: false },
      }));
      throw new Error('force settings rollback');
    })).rejects.toThrow('force settings rollback');
    expect(await readSettings(db)).toEqual(beforeSettings);
    expect(await db.sync_records.get(beforeRecord.id)).toEqual(beforeRecord);
    expect(await db.sync_state.get('app')).toEqual(state);

    await updateSettings(db, (current) => ({
      ...current,
      clock: { ...current.clock, weekdayFormat: 'english-short' },
      search: { ...current.search, width: 'wide', autoFocus: true },
      shortcuts: { ...current.shortcuts, showNames: false },
    }));
    const after = await db.sync_records.get(beforeRecord.id);
    const afterState = await db.sync_state.get('app');
    if (after?.kind !== 'settings' || !afterState) throw new Error('同步设置更新缺失');
    expect(after.value.clock.value.weekdayFormat).toBe('english-short');
    expect(after.value.searchPreferences.value).toMatchObject({ width: 'wide', autoFocus: true });
    expect(after.value.shortcutPreferences.value.showNames).toBe(false);
    expect(afterState.generation).toBe(state.generation + 1);
  });
});

describe('字段版本捕获：网站字段', () => {
  it('只为改变的shortcut字段分配新版本，不变put不增加generation', async () => {
    const shortcut = await createShortcut(db, { groupId: defaultGroupId, title: '文档', url: 'example.com' });
    const state = await enableSync();
    const before = await db.sync_records.get(`shortcut:${shortcut.id}`);
    if (before?.kind !== 'shortcut') throw new Error('同步网站记录缺失');
    await updateShortcut(db, shortcut.id, { title: '新名称' });
    const after = await db.sync_records.get(before.id);
    if (after?.kind !== 'shortcut') throw new Error('同步网站记录缺失');
    expect(after.value.title).not.toEqual(before.value.title);
    expect(after.value.url).toEqual(before.value.url);
    expect(after.value.placement).toEqual(before.value.placement);
    expect(after.value.icon).toEqual(before.value.icon);
    const changedState = await db.sync_state.get('app');
    expect(changedState?.clock).toBe(state.clock + 1);
    expect(changedState?.generation).toBe(state.generation + 1);
    await updateShortcut(db, shortcut.id, { title: '新名称' });
    expect(await db.sync_state.get('app')).toEqual(changedState);
  });

  it('本地连续位置被apply规范化后，改名不会重写未变的position寄存器', async () => {
    const group = await createGroup(db, '工作');
    const shortcut = await createShortcut(db, { groupId: group.id, title: '文档', url: 'example.com' });
    await enableSync();
    const groupRecord = await db.sync_records.get(`group:${group.id}`);
    const shortcutRecord = await db.sync_records.get(`shortcut:${shortcut.id}`);
    if (groupRecord?.kind !== 'group' || shortcutRecord?.kind !== 'shortcut') throw new Error('同步实体记录缺失');
    const groupPosition = { ...groupRecord.value.position, value: 40 };
    const shortcutPlacement = { ...shortcutRecord.value.placement, value: { groupId: group.id, order: 41 } };
    const updatedGroupRecord = { ...groupRecord, value: { ...groupRecord.value, position: groupPosition } };
    const updatedShortcutRecord = { ...shortcutRecord, value: { ...shortcutRecord.value, placement: shortcutPlacement } };
    await db.sync_records.put(updatedGroupRecord);
    await db.sync_records.put(updatedShortcutRecord);
    await db.transaction('rw', [db.sync_state, db.groups, db.shortcuts], async () => {
      await db.sync_state.update('app', { suspended: true });
      await db.groups.update(group.id, { order: 0 });
      await db.shortcuts.update(shortcut.id, { order: 0 });
      await db.sync_state.update('app', { suspended: false });
    });

    await renameGroup(db, group.id, '工作区');
    await updateShortcut(db, shortcut.id, { title: '阅读' });

    const renamedGroup = await db.sync_records.get(groupRecord.id);
    const renamedShortcut = await db.sync_records.get(shortcutRecord.id);
    if (renamedGroup?.kind !== 'group' || renamedShortcut?.kind !== 'shortcut') throw new Error('同步实体记录缺失');
    expect(renamedGroup.value.position).toEqual(groupPosition);
    expect(renamedShortcut.value.placement).toEqual(shortcutPlacement);
  });
});

describe('网站删除与撤销', () => {
  it('删除在撤销窗内保留活记录，恢复同ID不丢失旧版本', async () => {
    const shortcut = await createShortcut(db, { groupId: defaultGroupId, title: '文档', url: 'example.com' });
    await enableSync();
    const removed = await deleteShortcut(db, shortcut.id);
    const pending = await db.sync_records.get(`shortcut:${shortcut.id}`);
    if (pending?.kind !== 'shortcut') throw new Error('待撤销网站记录缺失');
    const oldTitle = pending.value.title;
    expect(pending.pendingDeleteUntil).toBe(now + 5_000);
    expect(pending).not.toHaveProperty('tombstone');

    now += 4_999;
    await restoreShortcut(db, removed);
    const restored = await db.sync_records.get(pending.id);
    if (restored?.kind !== 'shortcut') throw new Error('恢复后网站记录缺失');
    expect(restored.pendingDeleteUntil).toBeUndefined();
    expect(restored.value.title).toEqual(oldTitle);
  });

  it('撤销到期后拒绝恢复，并由finalize写入墓碑', async () => {
    const shortcut = await createShortcut(db, { groupId: defaultGroupId, title: '文档', url: 'example.com' });
    await enableSync();
    const removed = await deleteShortcut(db, shortcut.id);
    now += 5_000;
    await expect(restoreShortcut(db, removed)).rejects.toThrow('网站撤销期限已过');
    expect(await finalizePendingDeletes(db)).toBe(1);
    const grave = await db.sync_records.get(`shortcut:${shortcut.id}`);
    expect(grave).toMatchObject({ kind: 'tombstone', entityId: shortcut.id,
      tombstone: { entityType: 'shortcut', id: shortcut.id } });
    expect(await db.shortcuts.get(shortcut.id)).toBeUndefined();
    await expect(restoreShortcut(db, removed)).rejects.toThrow('已同步删除的网站不能复活');
  });
});

describe('图片缓存回收', () => {
  it('到期的删除会释放暂存Blob并增加代次', async () => {
    const asset = await createImageAsset(db, image());
    const shortcut = await createShortcut(db, { groupId: defaultGroupId, title: '图片', url: 'example.com',
      icon: { kind: 'asset', assetId: asset.id }, iconSourceUrl: asset.sourceUrl });
    await enableSync();
    await deleteShortcut(db, shortcut.id);
    const cached = await db.sync_records.get(`asset:${asset.id}`);
    if (cached?.kind !== 'asset') throw new Error('图片来源记录缺失');
    expect(cached.retainedAsset?.blob.size).toBe(asset.blob.size);
    now += 5_000;
    expect(await finalizePendingDeletes(db)).toBe(1);
    const finalizedAsset = await db.sync_records.get(`asset:${asset.id}`);
    if (finalizedAsset?.kind !== 'asset') throw new Error('图片来源记录缺失');
    expect(finalizedAsset.retainedAsset).toBeUndefined();
  });
});

describe('分组删除传播', () => {
  it('删除分组立即墓碑化该组及其网站', async () => {
    const group = await createGroup(db, '工作');
    const shortcut = await createShortcut(db, { groupId: group.id, title: '文档', url: 'example.com' });
    await enableSync();
    await deleteGroup(db, group.id);
    expect(await db.sync_records.get(`group:${group.id}`)).toMatchObject({ kind: 'tombstone', entityId: group.id,
      tombstone: { entityType: 'group' } });
    expect(await db.sync_records.get(`shortcut:${shortcut.id}`)).toMatchObject({ kind: 'tombstone', entityId: shortcut.id,
      tombstone: { entityType: 'shortcut' } });
  });
});
