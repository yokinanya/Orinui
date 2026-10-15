import type { MediaAssetKind } from '@/domain/asset';
import { fail } from '@/domain/errors';

export const IMAGE_FILE_LIMIT = 10 * 1024 * 1024;
export const IMAGE_LIMITS = {
  background: { pixels: 40_000_000, edge: 2560 },
  icon: { pixels: 4_000_000, edge: 1024 },
} as const;
export const SVG_EDGE_LIMIT = 1024;
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/svg+xml';
export const DEFAULT_PHOTO_MASK = 0.55;

export function validateImageFile(blob: Blob): void {
  if (blob.size === 0) fail('图片内容为空');
  if (blob.size > IMAGE_FILE_LIMIT) fail('图片原文件不能超过 10 MiB');
  if (!IMAGE_ACCEPT.split(',').includes(blob.type)) {
    fail('只支持 JPEG、PNG、WebP 和安全的静态 SVG');
  }
}

export function imageOutputSize(input: {
  readonly width: number;
  readonly height: number;
  readonly kind: MediaAssetKind;
  readonly svg?: boolean;
}): { width: number; height: number } {
  const { width, height, kind, svg } = input;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    fail('图片尺寸不正确');
  }
  const limits = IMAGE_LIMITS[kind];
  if (width * height > limits.pixels) fail(`图片像素不能超过 ${limits.pixels / 1_000_000} MP`);
  const edge = svg ? SVG_EDGE_LIMIT : limits.edge;
  const ratio = Math.min(1, edge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) };
}
