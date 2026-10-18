import type { MediaAsset } from '@/domain/asset';
import { fail } from '@/domain/errors';
import { newId } from '@/domain/id';
import { normalizeOptionalAssetName } from '@/domain/text';

import { SETTINGS_ID, type Database, type SettingsRow } from '@/storage/db';
import type { Shortcut } from '@/domain/shortcut';
import { IMAGE_LIMITS, imageOutputSize } from '@/domain/image';

export interface NewMediaAsset {
  readonly kind: MediaAsset['kind'];
  readonly mime: MediaAsset['mime'];
  readonly width: number;
  readonly height: number;
  readonly blob: Blob;
  readonly sourceUrl?: string | null;
  readonly name?: string | null;
  readonly motion?: MediaAsset['motion'];
  readonly createdAt?: number;
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
  if (!input.background && (background?.kind === 'photo' || background?.kind === 'motion') && background.assetId === input.id) return;
  await db.assets.delete(input.id);
}

export async function createMediaAsset(db: Database, input: NewMediaAsset): Promise<MediaAsset> {
  validateMediaAsset(input);

  return db.transaction('rw', db.assets, async () => {
    const asset: MediaAsset = {
      id: newId(),
      kind: input.kind,
      mime: input.mime,
      width: input.width,
      height: input.height,
      blob: input.blob,
      sourceUrl: input.sourceUrl ?? null,
      name: input.name ?? null,
      createdAt: input.createdAt ?? Date.now(),
      ...(input.motion ? { motion: input.motion } : {}),
    };

    await db.assets.add(asset);
    return asset;
  });
}

function validateMediaAsset(input: NewMediaAsset): void {
  if (input.blob.size === 0) fail('媒体内容为空');
  if (input.motion) {
    validateMotionAsset(input);
    return;
  }
  validateImageAsset(input);
}

function validateImageAsset(input: NewMediaAsset): void {
  validateImageKindAndSize(input);
  validateImageAssetMime(input);
}

function validateImageAssetMime(input: NewMediaAsset): void {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(input.mime) || input.blob.type !== input.mime) {
    fail('图片资源格式不正确');
  }
  if (input.kind === 'icon' && !['image/png', 'image/svg+xml'].includes(input.mime)) fail('图标需要 PNG 或安全 SVG');
  if (input.mime === 'image/svg+xml' && input.kind !== 'icon') fail('SVG 仅可用于网站图标');
}

function validateImageKindAndSize(input: NewMediaAsset): void {
  if (!Object.hasOwn(IMAGE_LIMITS, input.kind)) fail('图片资源类别不正确');
  imageOutputSize(input);
  if (Math.max(input.width, input.height) > IMAGE_LIMITS[input.kind].edge) fail('图片输出尺寸超限');
}

function motionKind(input: NewMediaAsset): 'video' | 'animation' {
  if (input.mime === 'video/mp4' || input.mime === 'video/webm') return 'video';
  if (input.mime === 'image/gif' || input.mime === 'image/webp') return 'animation';
  return fail('动态媒体格式不正确');
}

function validateMotionLocation(input: NewMediaAsset): void {
  if (input.kind !== 'background' || (input.sourceUrl ?? null) !== null) fail('动态媒体仅可作为本地背景保存');
}

function validateMotionMime(input: NewMediaAsset, kind: 'video' | 'animation'): void {
  if (input.blob.type !== input.mime || input.motion?.kind !== kind) fail('动态媒体类型与格式不匹配');
}

function validateMotionDimensions(input: NewMediaAsset): void {
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width <= 0 || input.height <= 0) {
    fail('动态媒体尺寸不正确');
  }
}

function validateMotionDuration(input: NewMediaAsset, kind: 'video' | 'animation'): void {
  const duration = input.motion?.duration;
  if (kind === 'video' && (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)) fail('视频时长不正确');
  if (kind === 'animation' && duration !== null) fail('动图不保存视频时长');
}

function validateMotionPoster(input: NewMediaAsset): void {
  const poster = input.motion?.poster;
  if (!poster || poster.size === 0 || !['image/png', 'image/jpeg', 'image/webp'].includes(poster.type)) fail('动态媒体封面缓存不正确');
}

function validateMotionAsset(input: NewMediaAsset): void {
  validateMotionLocation(input);
  const kind = motionKind(input);
  validateMotionMime(input, kind);
  validateMotionDimensions(input);
  validateMotionDuration(input, kind);
  validateMotionPoster(input);
}

export async function getMediaAsset(db: Database, id: string): Promise<MediaAsset | undefined> {
  return db.assets.get(id);
}

export async function listBackgroundAssets(db: Database): Promise<MediaAsset[]> {
  return db.assets.where('kind').equals('background').toArray();
}

/** 素材库按创建顺序稳定展示，不依赖主键排序。 */
function newestFirst(left: MediaAsset, right: MediaAsset): number {
  return (right.createdAt ?? 0) - (left.createdAt ?? 0);
}

export async function listLibraryAssets(db: Database): Promise<MediaAsset[]> {
  return (await listBackgroundAssets(db)).toSorted(newestFirst);
}

export async function renameBackgroundAsset(db: Database, id: string, name: string): Promise<void> {
  const normalized = normalizeOptionalAssetName(name) || null;
  await db.transaction('rw', db.assets, async () => {
    const asset = await db.assets.get(id);
    if (!asset || asset.kind !== 'background') fail('壁纸素材不存在');
    await db.assets.update(id, { name: normalized });
  });
}

export async function moveBackgroundAsset(db: Database, input: {
  readonly id: string;
  readonly direction: -1 | 1;
}): Promise<boolean> {
  return db.transaction('rw', db.assets, async () => {
    const ordered = (await listBackgroundAssets(db)).toSorted(newestFirst);
    const current = ordered.find((asset) => asset.id === input.id);
    if (!current) fail('壁纸素材不存在');
    const target = ordered[ordered.indexOf(current) + input.direction];
    if (!target) return false;
    await swapCreatedAt(db, current, target);
    return true;
  });
}

/** 排序用相邻两项的时间戳互换，不需要额外字段，也不破坏已保存的备份与同步结构。 */
async function swapCreatedAt(db: Database, left: MediaAsset, right: MediaAsset): Promise<void> {
  const leftTime = left.createdAt ?? 0;
  await db.assets.update(left.id, { createdAt: right.createdAt ?? 0 });
  await db.assets.update(right.id, { createdAt: leftTime });
}

export async function deleteMediaAsset(db: Database, id: string): Promise<void> {
  return db.transaction('rw', db.assets, async () => {
    await db.assets.delete(id);
  });
}

function referencedAssetIds(settings: SettingsRow | undefined, shortcuts: Shortcut[]): Set<string> {
  const ids = new Set<string>();

  const background = settings?.appearance.background;
  if (background?.kind === 'photo' || background?.kind === 'motion') {
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
      if (asset.kind === 'background') return;
      if (!referenced.has(asset.id)) orphans.push(asset.id);
    });

    if (orphans.length > 0) {
      await db.assets.bulkDelete(orphans);
    }
    return orphans.length;
  });
}

export async function reorderBackgroundAsset(db: Database, input: { readonly id: string; readonly targetId: string }): Promise<void> {
  await db.transaction('rw', db.assets, async () => {
    const ordered = await listLibraryAssets(db);
    const from = ordered.findIndex(({ id }) => id === input.id);
    const to = ordered.findIndex(({ id }) => id === input.targetId);
    if (from < 0 || to < 0) fail('壁纸素材不存在');
    const moved = [...ordered];
    const [asset] = moved.splice(from, 1);
    moved.splice(to, 0, asset!);
    const baseTime = Date.now();
    await Promise.all(moved.map((item, index) => db.assets.update(item.id, { createdAt: baseTime - index })));
  });
}
