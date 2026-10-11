import type { ImageAsset } from '@/domain/asset';
import { fail } from '@/domain/errors';
import { newId } from '@/domain/id';

import { SETTINGS_ID, type Database, type SettingsRow } from '@/storage/db';
import type { Shortcut } from '@/domain/shortcut';
import { IMAGE_LIMITS, imageOutputSize } from '@/domain/image';

/** 数据契约 §5.3：本地自定义图片总量上限。 */
export const ASSET_TOTAL_LIMIT_BYTES = 50 * 1024 * 1024;

export interface NewImageAsset {
  readonly kind: ImageAsset['kind'];
  readonly mime: ImageAsset['mime'];
  readonly width: number;
  readonly height: number;
  readonly blob: Blob;
  readonly sourceUrl?: string | null;
}

/** 替换时只释放独占的旧资源；同一事务失败会恢复旧数据。 */
export async function releaseReplacedAsset(db: Database, input: {
  readonly id: string;
  readonly shortcutId?: string;
  readonly background?: boolean;
}): Promise<void> {
  const references = await db.shortcuts.toArray();
  if (references.some((item) => item.id !== input.shortcutId && item.icon.kind === 'asset' && item.icon.assetId === input.id)) return;
  const background = (await db.settings.get(SETTINGS_ID))?.appearance.background;
  if (!input.background && background?.kind === 'photo' && background.assetId === input.id) return;
  await db.assets.delete(input.id);
}

export async function totalAssetBytes(db: Database): Promise<number> {
  let total = 0;
  await db.assets.each((asset) => {
    total += asset.blob.size;
  });
  return total;
}

export async function createImageAsset(db: Database, input: NewImageAsset): Promise<ImageAsset> {
  if (!Object.hasOwn(IMAGE_LIMITS, input.kind)) fail('图片资源类别不正确');
  imageOutputSize(input);
  if (Math.max(input.width, input.height) > IMAGE_LIMITS[input.kind].edge) fail('图片输出尺寸超限');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(input.mime) || input.blob.type !== input.mime) {
    fail('图片资源格式不正确');
  }
  if (input.kind === 'icon' && input.mime !== 'image/png') fail('图标需要静态 PNG');
  if (input.blob.size === 0) {
    fail('图片内容为空');
  }

  return db.transaction('rw', db.assets, async () => {
    const total = await totalAssetBytes(db);
    if (total + input.blob.size > ASSET_TOTAL_LIMIT_BYTES) {
      const limitMb = Math.round(ASSET_TOTAL_LIMIT_BYTES / (1024 * 1024));
      fail(`本地图片总大小不能超过 ${limitMb} MiB，请先替换或删除已有图片`);
    }

    const asset: ImageAsset = {
      id: newId(),
      kind: input.kind,
      mime: input.mime,
      width: input.width,
      height: input.height,
      blob: input.blob,
      sourceUrl: input.sourceUrl ?? null,
    };

    await db.assets.add(asset);
    return asset;
  });
}

export async function getImageAsset(db: Database, id: string): Promise<ImageAsset | undefined> {
  return db.assets.get(id);
}

export async function deleteImageAsset(db: Database, id: string): Promise<void> {
  return db.transaction('rw', db.assets, async () => {
    await db.assets.delete(id);
  });
}

function referencedAssetIds(settings: SettingsRow | undefined, shortcuts: Shortcut[]): Set<string> {
  const ids = new Set<string>();

  const background = settings?.appearance.background;
  if (background?.kind === 'photo') {
    ids.add(background.assetId);
  }
  for (const shortcut of shortcuts) {
    if (shortcut.icon.kind === 'asset') {
      ids.add(shortcut.icon.assetId);
    }
  }

  return ids;
}

/**
 * 清理不再被任何记录引用的图片。
 *
 * 数据契约 §5.6：按引用关系清理，替换或删除图片后调用，
 * 避免孤立资源长期占用本地配额。
 */
export async function pruneUnreferencedAssets(db: Database): Promise<number> {
  return db.transaction('rw', db.assets, db.settings, db.shortcuts, async () => {
    const referenced = referencedAssetIds(await db.settings.get(SETTINGS_ID), await db.shortcuts.toArray());

    const orphans: string[] = [];
    await db.assets.each((asset) => {
      if (!referenced.has(asset.id)) orphans.push(asset.id);
    });

    if (orphans.length > 0) {
      await db.assets.bulkDelete(orphans);
    }
    return orphans.length;
  });
}
