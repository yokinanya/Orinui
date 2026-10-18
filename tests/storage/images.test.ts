import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { createFolder, deleteFolder } from '@/storage/folders';
import { ensureInitialized } from '@/storage/init';
import { activateBackgroundAsset, deleteBackgroundAsset, setMotionBackground, setPhotoBackground } from '@/storage/image-operations';
import { readSettings } from '@/storage/settings';
import { createShortcut, deleteShortcut, restoreShortcut, updateShortcut } from '@/storage/shortcuts';
import { createMediaAsset, type NewMediaAsset } from '@/storage/assets';

let db: Database;
let folderId: string;
const image = (kind: 'icon' | 'background' = 'icon'): NewMediaAsset => ({
  kind, width: 10, height: 10, mime: 'image/png', blob: new Blob(['pixels'], { type: 'image/png' }),
});
const motion = (): NewMediaAsset => ({ kind: 'background', width: 1280, height: 720, mime: 'video/webm',
  blob: new Blob(['video'], { type: 'video/webm' }), sourceUrl: null,
  motion: { kind: 'video', duration: 12, poster: new Blob(['poster'], { type: 'image/png' }) } });
beforeEach(async () => {
  db = createDatabase(`images-${crypto.randomUUID()}`);
  await ensureInitialized(db);
  folderId = (await createFolder(db, '测试')).id;
});
afterEach(async () => { db.close(); await db.delete(); });

describe('照片背景事务', () => {
  it('照片与设置一起保存，替换时保留旧照片素材', async () => {
    await setPhotoBackground(db, image('background'));
    const original = (await readSettings(db)).appearance.background;
    await setPhotoBackground(db, image('background'));
    expect((await readSettings(db)).appearance.background).not.toEqual(original);
    expect(await db.assets.count()).toBe(2);
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

describe('动态背景存储', () => {
  it('动态媒体、封面缓存和设置一起保存，替换后保留旧资源', async () => {
    await setMotionBackground(db, motion());
    const first = (await readSettings(db)).appearance.background;
    expect(first.kind).toBe('motion');
    if (first.kind !== 'motion') throw new Error('动态背景未保存');
    expect((await db.assets.get(first.assetId))?.motion?.poster?.type).toBe('image/png');
    await setMotionBackground(db, motion());
    expect(await db.assets.count()).toBe(2);
    expect((await readSettings(db)).appearance.background).not.toEqual(first);
  });
  it('拒绝来源链接或与 MIME 不一致的动态元数据', async () => {
    await expect(setMotionBackground(db, { ...motion(), sourceUrl: 'https://example.test/video.webm' })).rejects.toThrow(/本地动态媒体/);
    await expect(setMotionBackground(db, { ...motion(), mime: 'video/mp4' })).rejects.toThrow(/动态媒体类型与格式/);
    expect(await db.assets.count()).toBe(0);
  });
  it('从动态背景切换为照片时保留动态素材', async () => {
    await setMotionBackground(db, motion());
    await setPhotoBackground(db, image('background'));
    expect((await readSettings(db)).appearance.background.kind).toBe('photo');
    expect(await db.assets.count()).toBe(2);
  });
  it('应用未激活素材并在删除当前素材时原子切回默认背景', async () => {
    await setPhotoBackground(db, image('background'));
    await setMotionBackground(db, motion());
    const current = (await readSettings(db)).appearance.background;
    if (current.kind !== 'motion') throw new Error('动态背景未生效');
    const photo = (await db.assets.where('kind').equals('background').toArray()).find((asset) => asset.mime === 'image/png');
    if (!photo) throw new Error('照片素材未保留');
    await activateBackgroundAsset(db, photo.id);
    expect((await readSettings(db)).appearance.background.kind).toBe('photo');
    const active = (await readSettings(db)).appearance.background;
    if (active.kind !== 'photo') throw new Error('照片背景未生效');
    await deleteBackgroundAsset(db, active.assetId);
    expect((await readSettings(db)).appearance.background.kind).toBe('default');
    expect(await db.assets.count()).toBe(1);
  });
});

describe('网站图标生命周期', () => {
  it('保存网站时同时保存图片，非法网站不留下图片', async () => {
    await expect(createShortcut(db, { folderId, title: '站点', url: 'javascript:x', image: image() })).rejects.toThrow();
    expect(await db.assets.count()).toBe(0);
    const shortcut = await createShortcut(db, { folderId, title: '站点', url: 'example.com', image: image() });
    expect(shortcut.icon.kind).toBe('asset');
    expect(await db.assets.count()).toBe(1);
  });
  it('切回文字图标清理图片', async () => {
    const shortcut = await createShortcut(db, { folderId, title: '站点', url: 'example.com', image: image() });
    await updateShortcut(db, shortcut.id, { icon: { kind: 'letter' } });
    expect(await db.assets.count()).toBe(0);
  });
  it('删除清理图标，撤销从会话快照恢复图片', async () => {
    const shortcut = await createShortcut(db, { folderId, title: '站点', url: 'example.com', image: image() });
    const removed = await deleteShortcut(db, shortcut.id);
    expect(await db.assets.count()).toBe(0);
    await restoreShortcut(db, removed);
    expect(await db.assets.count()).toBe(1);
    expect((await db.shortcuts.get(shortcut.id))?.icon).toEqual(shortcut.icon);
    expect(await db.shortcuts.get(shortcut.id)).not.toHaveProperty('removedAsset');
  });
  it('撤销重复执行时回滚，不新增孤立图片', async () => {
    const shortcut = await createShortcut(db, { folderId, title: '站点', url: 'example.com', image: image() });
    const removed = await deleteShortcut(db, shortcut.id);
    await restoreShortcut(db, removed);
    await expect(restoreShortcut(db, removed)).rejects.toThrow();
    expect(await db.assets.count()).toBe(1);
  });
  it('删除文件夹不会带走网站图片', async () => {
    const folder = await createFolder(db, '工作');
    await createShortcut(db, { folderId: folder.id, title: '站点', url: 'example.com', image: image() });
    await deleteFolder(db, folder.id);
    expect(await db.assets.count()).toBe(1);
  });
  it('共享资源不会因单个网站删除而消失', async () => {
    const first = await createShortcut(db, { folderId, title: '一', url: 'example.com', image: image() });
    await createShortcut(db, { folderId, title: '二', url: 'example.com', icon: first.icon });
    await deleteShortcut(db, first.id);
    expect(await db.assets.count()).toBe(1);
  });
});

describe('媒体引用与容量', () => {
  it('拒绝不存在的图标引用和错误资源类型', async () => {
    await expect(createShortcut(db, { folderId, title: '站点', url: 'example.com', icon: { kind: 'asset', assetId: 'missing' } })).rejects.toThrow(/不存在/);
    await expect(createShortcut(db, { folderId, title: '站点', url: 'example.com', image: image('background') })).rejects.toThrow(/图标图片/);
    expect(await db.shortcuts.count()).toBe(0);
  });
  it('存储不设置 50 MiB 总容量上限', async () => {
    const full = { ...image('background'), blob: new Blob([new Uint8Array(50 * 1024 * 1024)], { type: 'image/png' }) };
    await createMediaAsset(db, full);
    await createMediaAsset(db, image('background'));
    expect(await db.assets.count()).toBe(2);
  });
  it('替换网站图标失败时恢复旧图标和引用', async () => {
    const shortcut = await createShortcut(db, { folderId, title: '站点', url: 'example.com', image: image() });
    await expect(updateShortcut(db, shortcut.id, { image: { ...image(), mime: 'image/jpeg' } })).rejects.toThrow();
    expect(await db.shortcuts.get(shortcut.id)).toEqual(shortcut);
    expect(await db.assets.count()).toBe(1);
  });
});
