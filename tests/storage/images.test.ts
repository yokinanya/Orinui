import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { setPhotoBackground } from '@/storage/image-operations';
import { readSettings } from '@/storage/settings';
import { createShortcut, deleteShortcut, restoreShortcut, updateShortcut } from '@/storage/shortcuts';
import { createGroup, deleteGroup } from '@/storage/groups';
import { ASSET_TOTAL_LIMIT_BYTES, createImageAsset, type NewImageAsset } from '@/storage/assets';

let db: Database;
let groupId: string;
const image = (kind: 'icon' | 'background' = 'icon'): NewImageAsset => ({
  kind, width: 10, height: 10, mime: 'image/png', blob: new Blob(['pixels'], { type: 'image/png' }),
});
beforeEach(async () => {
  db = createDatabase(`images-${crypto.randomUUID()}`);
  groupId = (await ensureInitialized(db)).defaultGroup.id;
});
afterEach(async () => { db.close(); await db.delete(); });

describe('照片背景事务', () => {
  it('照片与设置一起保存，替换后删除旧照片', async () => {
    await setPhotoBackground(db, image('background'));
    const original = (await readSettings(db)).appearance.background;
    await setPhotoBackground(db, image('background'));
    expect((await readSettings(db)).appearance.background).not.toEqual(original);
    expect(await db.assets.count()).toBe(1);
  });
  it('转换结果格式不匹配时保留原背景', async () => {
    await setPhotoBackground(db, image('background'));
    const previous = await readSettings(db);
    await expect(setPhotoBackground(db, { ...image('background'), mime: 'image/jpeg' })).rejects.toThrow(/格式/);
    expect(await readSettings(db)).toEqual(previous);
    expect(await db.assets.count()).toBe(1);
  });
  it('设置校验失败时回滚新图片', async () => {
    await db.settings.update('app', { layout: { order: ['unknown'], hidden: [] } as never });
    await expect(setPhotoBackground(db, image('background'))).rejects.toThrow();
    expect(await db.assets.count()).toBe(0);
  });
});

describe('网站图标生命周期', () => {
  it('保存网站时同时保存图片，非法网站不留下图片', async () => {
    await expect(createShortcut(db, { groupId, title: '站点', url: 'javascript:x', image: image() })).rejects.toThrow();
    expect(await db.assets.count()).toBe(0);
    const shortcut = await createShortcut(db, { groupId, title: '站点', url: 'example.com', image: image() });
    expect(shortcut.icon.kind).toBe('asset');
    expect(await db.assets.count()).toBe(1);
  });
  it('切回文字图标清理图片', async () => {
    const shortcut = await createShortcut(db, { groupId, title: '站点', url: 'example.com', image: image() });
    await updateShortcut(db, shortcut.id, { icon: { kind: 'letter' } });
    expect(await db.assets.count()).toBe(0);
  });
  it('删除清理图标，撤销从会话快照恢复图片', async () => {
    const shortcut = await createShortcut(db, { groupId, title: '站点', url: 'example.com', image: image() });
    const removed = await deleteShortcut(db, shortcut.id);
    expect(await db.assets.count()).toBe(0);
    await restoreShortcut(db, removed);
    expect(await db.assets.count()).toBe(1);
    expect((await db.shortcuts.get(shortcut.id))?.icon).toEqual(shortcut.icon);
    expect(await db.shortcuts.get(shortcut.id)).not.toHaveProperty('removedAsset');
  });
  it('撤销重复执行时回滚，不新增孤立图片', async () => {
    const shortcut = await createShortcut(db, { groupId, title: '站点', url: 'example.com', image: image() });
    const removed = await deleteShortcut(db, shortcut.id);
    await restoreShortcut(db, removed);
    await expect(restoreShortcut(db, removed)).rejects.toThrow();
    expect(await db.assets.count()).toBe(1);
  });
  it('删除分组清理图片', async () => {
    const group = await createGroup(db, '工作');
    await createShortcut(db, { groupId: group.id, title: '站点', url: 'example.com', image: image() });
    await deleteGroup(db, group.id);
    expect(await db.assets.count()).toBe(0);
  });
  it('共享资源不会因单个网站删除而消失', async () => {
    const first = await createShortcut(db, { groupId, title: '一', url: 'example.com', image: image() });
    await createShortcut(db, { groupId, title: '二', url: 'example.com', icon: first.icon });
    await deleteShortcut(db, first.id);
    expect(await db.assets.count()).toBe(1);
  });
});

describe('图片引用与容量限制', () => {
  it('拒绝不存在的图标引用和错误资源类型', async () => {
    await expect(createShortcut(db, { groupId, title: '站点', url: 'example.com', icon: { kind: 'asset', assetId: 'missing' } })).rejects.toThrow(/不存在/);
    await expect(createShortcut(db, { groupId, title: '站点', url: 'example.com', image: image('background') })).rejects.toThrow(/图标图片/);
    expect(await db.shortcuts.count()).toBe(0);
  });
  it('达到总容量时新增失败，数据不变', async () => {
    const full = { ...image('background'), blob: new Blob([new Uint8Array(ASSET_TOTAL_LIMIT_BYTES)], { type: 'image/png' }) };
    await createImageAsset(db, full);
    await expect(createShortcut(db, { groupId, title: '站点', url: 'example.com', image: image() })).rejects.toThrow(/50 MiB/);
    expect(await db.shortcuts.count()).toBe(0);
    expect(await db.assets.count()).toBe(1);
  });
  it('替换独占照片时不把旧图和新图重复计入容量', async () => {
    await setPhotoBackground(db, { ...image('background'), blob: new Blob([new Uint8Array(ASSET_TOTAL_LIMIT_BYTES)], { type: 'image/png' }) });
    await setPhotoBackground(db, image('background'));
    expect(await db.assets.count()).toBe(1);
  });
  it('替换网站图标失败时恢复旧图标和引用', async () => {
    const shortcut = await createShortcut(db, { groupId, title: '站点', url: 'example.com', image: image() });
    await expect(updateShortcut(db, shortcut.id, { image: { ...image(), mime: 'image/jpeg' } })).rejects.toThrow();
    expect(await db.shortcuts.get(shortcut.id)).toEqual(shortcut);
    expect(await db.assets.count()).toBe(1);
  });
});
