import type { MediaAsset } from '@/domain/asset';
import { isMotionMime, validateMotionRecord, type MotionMime } from '@/domain/motion';
import { decodeAnimation, decodeVideo, type MediaFrame } from '@/platform/media-frame';
import { validateStoredMediaAsset as validateStaticImageAsset } from '@/platform/sync-images';
import type { NewMediaAsset } from '@/storage/assets';

const SIGNATURE_BYTES = 16;
const WEBM_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3] as const;
const text = (bytes: Uint8Array, start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end));

const SIGNATURES: readonly { readonly mime: MotionMime; readonly matches: (bytes: Uint8Array) => boolean }[] = [
  { mime: 'image/gif', matches: (bytes) => ['GIF87a', 'GIF89a'].includes(text(bytes, 0, 6)) },
  { mime: 'image/webp', matches: (bytes) => text(bytes, 0, 4) === 'RIFF' && text(bytes, 8, 12) === 'WEBP' },
  { mime: 'video/mp4', matches: (bytes) => text(bytes, 4, 8) === 'ftyp' },
  { mime: 'video/webm', matches: (bytes) => WEBM_SIGNATURE.every((byte, index) => bytes[index] === byte) },
];

export async function detectMotionMime(blob: Blob): Promise<MotionMime> {
  if (!blob.size) throw new Error('动态壁纸文件为空');
  const bytes = new Uint8Array(await blob.slice(0, SIGNATURE_BYTES).arrayBuffer());
  const mime = SIGNATURES.find((candidate) => candidate.matches(bytes))?.mime;
  if (!mime) throw new Error('只支持有效的 MP4、WebM、GIF 或动态 WebP 文件');
  if (blob.type && blob.type !== mime) throw new Error('动态壁纸内容与声明格式不一致');
  return mime;
}

async function motionFrame(blob: Blob, mime: MotionMime): Promise<MediaFrame> {
  return mime.startsWith('video/') ? decodeVideo(blob) : decodeAnimation(blob);
}

export async function prepareMotionMedia(file: Blob): Promise<NewMediaAsset> {
  const mime = await detectMotionMime(file);
  const blob = file.slice(0, file.size, mime);
  const frame = await motionFrame(blob, mime);
  return { kind: 'background', mime, width: frame.width, height: frame.height, blob, sourceUrl: null,
    motion: { kind: mime.startsWith('video/') ? 'video' : 'animation', duration: frame.duration, poster: frame.poster } };
}

export async function validateStoredMediaAsset(asset: MediaAsset): Promise<MediaAsset> {
  if (!asset.motion) {
    await validateStaticImageAsset(asset);
    return asset;
  }
  validateMotionRecord(asset);
  const mime = await detectMotionMime(asset.blob);
  if (mime !== asset.mime || !isMotionMime(mime)) throw new Error('动态壁纸格式与资源记录不一致');
  const frame = await motionFrame(asset.blob, mime);
  if (frame.width !== asset.width || frame.height !== asset.height || frame.duration !== asset.motion.duration) {
    throw new Error('动态壁纸实际内容与资源记录不一致');
  }
  return { ...asset, motion: { ...asset.motion, poster: frame.poster } };
}
