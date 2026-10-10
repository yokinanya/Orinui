import type { ImageAsset } from '@/domain/asset';
import { fail } from '@/domain/errors';
import { newId } from '@/domain/id';

import { SETTINGS_ID, type Database, type SettingsRow } from '@/storage/db';
import type { Shortcut } from '@/domain/shortcut';

/** 数据契约 §5.3：本地自定义图片总量上限。 */
export const ASSET_TOTAL_LIMIT_BYTES = 50 * 1024 * 1024;

export interface NewImageAsset {
  kind: ImageAsset['kind'];
  mime: ImageAsset['mime'];
  width: number;
  height: number;
  blob: Blob;
  sourceUrl?: string | null;
}

export async function totalAssetBytes(db: Database): Promise<number> {
  let total = 0;
  await db.assets.each((asset) => {
    total += asset.blob.size;
  });
  return total;
}

export async function createImageAsset(db: Database, input: NewImageAsset): Promise<ImageAsset> {
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
