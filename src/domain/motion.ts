import type { MediaAsset, MediaAssetMotion } from '@/domain/asset';

export const MOTION_ACCEPT = 'video/mp4,video/webm,image/gif,image/webp';
export const MOTION_MIMES = ['video/mp4', 'video/webm', 'image/gif', 'image/webp'] as const;
export type MotionMime = typeof MOTION_MIMES[number];
export const POSTER_EDGE = 1280;

export function isMotionMime(mime: string): mime is MotionMime {
  return MOTION_MIMES.some((candidate) => candidate === mime);
}

function validateMotionPlacement(asset: MediaAsset): asserts asset is MediaAsset & { readonly motion: MediaAssetMotion } {
  if (!asset.motion || asset.kind !== 'background' || asset.sourceUrl !== null) {
    throw new Error('动态壁纸必须是本地上传的背景资源');
  }
}

function validateMotionDuration(duration: number | null, video: boolean): void {
  if (!video) {
    if (duration !== null) throw new Error('动图不保存视频时长');
    return;
  }
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) throw new Error('视频时长不正确');
}

export function validateMotionRecord(asset: MediaAsset): void {
  validateMotionPlacement(asset);
  const video = asset.mime === 'video/mp4' || asset.mime === 'video/webm';
  if (!isMotionMime(asset.mime) || asset.motion.kind !== (video ? 'video' : 'animation')) {
    throw new Error('动态壁纸类型与媒体格式不一致');
  }
  if (![asset.width, asset.height].every((size) => Number.isSafeInteger(size) && size > 0)) {
    throw new Error('动态壁纸尺寸不正确');
  }
  validateMotionDuration(asset.motion.duration, video);
}
