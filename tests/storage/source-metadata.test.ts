import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { setPhotoBackground } from '@/storage/image-operations';
import { readSettings } from '@/storage/settings';
import { createShortcut } from '@/storage/shortcuts';
import { clearImageSourceUrl } from '@/storage/source-metadata';

let db: Database;
let groupId: string;
const sourceUrl = 'https://images.example/icon.png';
const image = (kind: 'icon' | 'background') => ({ kind, width: 10, height: 10, mime: 'image/png' as const,
  blob: new Blob(['pixels'], { type: 'image/png' }), sourceUrl });

beforeEach(async () => {
  db = createDatabase(`source-metadata-${crypto.randomUUID()}`);
  groupId = (await ensureInitialized(db)).defaultGroup.id;
});
afterEach(async () => { db.close(); await db.delete(); });

describe('图片来源元数据清除', () => {
  it('清除共享图标来源并保留图片 Blob 与全部资源引用', async () => {
    const first = await createShortcut(db, { groupId, title: '一', url: 'one.example', image: image('icon'), iconSourceUrl: sourceUrl });
    const second = await createShortcut(db, { groupId, title: '二', url: 'two.example', icon: first.icon, iconSourceUrl: sourceUrl });
    const before = await db.assets.get(first.icon.kind === 'asset' ? first.icon.assetId : '');
    if (!before) throw new Error('测试图片未创建');

    await clearImageSourceUrl(db, before.id);

    const after = await db.assets.get(before.id);
    expect(after).toMatchObject({ ...before, sourceUrl: null });
    expect(after?.blob.size).toBe(before.blob.size);
    expect(await after?.blob.text()).toBe(await before.blob.text());
    expect((await db.shortcuts.get(first.id))?.icon).toEqual(first.icon);
    expect((await db.shortcuts.get(second.id))?.icon).toEqual(second.icon);
    expect((await db.shortcuts.get(first.id))?.iconSourceUrl).toBeNull();
    expect((await db.shortcuts.get(second.id))?.iconSourceUrl).toBeNull();
  });

  it('可清除背景照片来源且保留 Blob 和背景设置引用', async () => {
    await setPhotoBackground(db, image('background'));
    const background = (await readSettings(db)).appearance.background;
    if (background.kind !== 'photo') throw new Error('测试背景未保存');
    const before = await db.assets.get(background.assetId);
    if (!before) throw new Error('测试背景图片未创建');

    await clearImageSourceUrl(db, before.id);

    expect((await readSettings(db)).appearance.background).toEqual(background);
    expect(await db.assets.get(before.id)).toMatchObject({ ...before, sourceUrl: null });
    expect(await (await db.assets.get(before.id))?.blob.text()).toBe(await before.blob.text());
  });

  it('资源不存在或来源已经清除时明确报错', async () => {
    await expect(clearImageSourceUrl(db, 'missing')).rejects.toThrow('图片资源不存在');
    await db.assets.add({ ...image('icon'), id: 'local', sourceUrl: null });
    await expect(clearImageSourceUrl(db, 'local')).rejects.toThrow('图片没有可清除的来源地址');
  });
});
