import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createMediaAsset, listLibraryAssets, reorderBackgroundAsset, moveBackgroundAsset, renameBackgroundAsset } from '@/storage/assets';

const PNG = (label: string) => new Blob([label], { type: 'image/png' });
/** 同一毫秒内创建的素材时间戳相同，测试显式指定时间以验证排序。 */
const photoOf = (label: string, createdAt: number) =>
  ({ kind: 'background', width: 10, height: 10, mime: 'image/png', blob: PNG(label), createdAt }) as const;

let db: Database;
beforeEach(async () => {
  db = createDatabase(`wallpaper-library-${crypto.randomUUID()}`);
  await ensureInitialized(db);
});
afterEach(async () => { db.close(); await db.delete(); });

describe('壁纸素材库', () => {
  it('按加入时间倒序展示，新建素材排在最前', async () => {
    const first = await createMediaAsset(db, photoOf('a', 1_000));
    const second = await createMediaAsset(db, photoOf('b', 2_000));
    expect((await listLibraryAssets(db)).map(({ id }) => id)).toEqual([second.id, first.id]);
  });

  it('重命名只改动素材名称，留空恢复默认名称', async () => {
    const asset = await createMediaAsset(db, photoOf('a', 1_000));
    await renameBackgroundAsset(db, asset.id, '  城市夜景  ');
    expect((await db.assets.get(asset.id))?.name).toBe('城市夜景');
    await renameBackgroundAsset(db, asset.id, '   ');
    expect((await db.assets.get(asset.id))?.name).toBeNull();
  });

  it('重命名拒绝非壁纸素材并保留原值', async () => {
    const icon = await createMediaAsset(db, { kind: 'icon', width: 10, height: 10, mime: 'image/png', blob: PNG('i') });
    await expect(renameBackgroundAsset(db, icon.id, '素材')).rejects.toThrow(/壁纸素材不存在/);
  });

  it('上移下移交换相邻素材顺序，边界处返回 false 且顺序不变', async () => {
    const first = await createMediaAsset(db, photoOf('a', 1_000));
    const second = await createMediaAsset(db, photoOf('b', 2_000));
    const third = await createMediaAsset(db, photoOf('c', 3_000));
    expect((await listLibraryAssets(db)).map(({ id }) => id)).toEqual([third.id, second.id, first.id]);
    expect(await moveBackgroundAsset(db, { id: third.id, direction: 1 })).toBe(true);
    expect((await listLibraryAssets(db)).map(({ id }) => id)).toEqual([second.id, third.id, first.id]);
    expect(await moveBackgroundAsset(db, { id: third.id, direction: -1 })).toBe(true);
    expect((await listLibraryAssets(db)).map(({ id }) => id)).toEqual([third.id, second.id, first.id]);
    expect(await moveBackgroundAsset(db, { id: third.id, direction: -1 })).toBe(false);
    expect(await moveBackgroundAsset(db, { id: first.id, direction: 1 })).toBe(false);
    expect((await listLibraryAssets(db)).map(({ id }) => id)).toEqual([third.id, second.id, first.id]);
  });
});

it('拖拽移动到目标位置，时间相同时仍持久化明确顺序；无效目标不写入', async () => {
  await createMediaAsset(db, photoOf('a', 1000));
  await createMediaAsset(db, photoOf('b', 1000));
  await createMediaAsset(db, photoOf('c', 1000));
  const [a, b, c] = (await listLibraryAssets(db)) as [Awaited<ReturnType<typeof createMediaAsset>>, Awaited<ReturnType<typeof createMediaAsset>>, Awaited<ReturnType<typeof createMediaAsset>>];
  await reorderBackgroundAsset(db, { id: c.id, targetId: a.id });
  expect((await listLibraryAssets(db)).map(({ id }) => id)).toEqual([c.id, a.id, b.id]);
  await reorderBackgroundAsset(db, { id: c.id, targetId: b.id });
  expect((await listLibraryAssets(db)).map(({ id }) => id)).toEqual([a.id, b.id, c.id]);
  await expect(reorderBackgroundAsset(db, { id: a.id, targetId: 'missing' })).rejects.toThrow('壁纸素材不存在');
  expect((await listLibraryAssets(db)).map(({ id }) => id)).toEqual([a.id, b.id, c.id]);
});
