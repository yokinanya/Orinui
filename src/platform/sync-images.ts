import { fail } from '@/domain/errors';
import { imageOutputSize } from '@/domain/image';
import type { ImageAsset } from '@/domain/asset';
import { animatedWebp, loadLocalImage } from '@/platform/images';
import { validateSvgImageAsset } from '@/platform/svg-image';

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_PREFIX = [0xff, 0xd8, 0xff] as const;
const WEBP_RIFF = 'RIFF';
const WEBP_FORMAT = 'WEBP';
const WEBP_FORMAT_OFFSET = 8;

function matchesBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

function hasWebpSignature(bytes: Uint8Array): boolean {
  if (bytes.length < WEBP_FORMAT_OFFSET + WEBP_FORMAT.length) return false;
  const text = new TextDecoder();
  return text.decode(bytes.subarray(0, WEBP_RIFF.length)) === WEBP_RIFF &&
    text.decode(bytes.subarray(WEBP_FORMAT_OFFSET, WEBP_FORMAT_OFFSET + WEBP_FORMAT.length)) === WEBP_FORMAT;
}

function validateSignature(mime: ImageAsset['mime'], bytes: Uint8Array): void {
  const valid = mime === 'image/png' ? matchesBytes(bytes, PNG_SIGNATURE)
    : mime === 'image/jpeg' ? matchesBytes(bytes, JPEG_PREFIX)
      : hasWebpSignature(bytes);
  if (!valid) fail('同步图片文件签名与声明格式不一致');
}

async function validateStoredImageAsset(asset: ImageAsset): Promise<void> {
  if (asset.blob.type !== asset.mime || asset.blob.size === 0) fail('同步图片 MIME 或内容大小不正确');
  if (asset.kind === 'icon' && asset.mime !== 'image/png' && asset.mime !== 'image/svg+xml') fail('网站图标必须是静态 PNG 或 SVG');
  if (asset.mime === 'image/svg+xml') { await validateSvgImageAsset(asset); return; }
  if (asset.mime === 'image/webp' && await animatedWebp(asset.blob)) fail('同步图片必须是静态 WebP');
  validateSignature(asset.mime, new Uint8Array(await asset.blob.slice(0, 12).arrayBuffer()));
}

function validateBitmapSize(asset: ImageAsset, bitmap: { readonly width: number; readonly height: number }): void {
  if (bitmap.width !== asset.width || bitmap.height !== asset.height) fail('同步图片实际尺寸与记录不一致');
  const output = imageOutputSize({ width: bitmap.width, height: bitmap.height, kind: asset.kind });
  if (output.width !== asset.width || output.height !== asset.height) fail('同步图片尺寸不符合保存规格');
}

export async function validateSyncImageAsset(asset: ImageAsset): Promise<void> {
  await validateStoredImageAsset(asset);
  if (asset.mime === 'image/svg+xml') {
    validateBitmapSize(asset, await loadLocalImage(asset.blob));
    return;
  }
  const bitmap = await createImageBitmap(asset.blob);
  try {
    validateBitmapSize(asset, bitmap);
  } finally {
    bitmap.close();
  }
}
