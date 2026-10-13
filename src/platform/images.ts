import { argbFromRgb, hexFromArgb, QuantizerCelebi, Score } from '@material/material-color-utilities';

import type { ImageAssetKind } from '@/domain/asset';
import { fail } from '@/domain/errors';
import { imageOutputSize, validateImageFile } from '@/domain/image';
import { prepareSvgImage } from '@/platform/svg-image';
import type { NewImageAsset } from '@/storage/assets';

const IMAGE_QUALITY = 0.9;
const ANIMATION_CHUNK = 'ANIM';
const PHOTO_SEED_EDGE = 128;
const RGBA_CHANNELS = 4;
const ALPHA_CHANNEL = 3;
const RED_CHANNEL = 0;
const GREEN_CHANNEL = 1;
const BLUE_CHANNEL = 2;
const OPAQUE_ALPHA = 255;
const COLOR_QUANTIZATION = 128;
const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

export async function animatedWebp(blob: Blob): Promise<boolean> {
  if (blob.type !== 'image/webp') return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  let position = RIFF_HEADER_BYTES;
  while (position + CHUNK_HEADER_BYTES <= bytes.length) {
    if (decoder.decode(bytes.subarray(position, position + 4)) === ANIMATION_CHUNK) return true;
    const size = view.getUint32(position + 4, true);
    position += CHUNK_HEADER_BYTES + size + (size % 2);
  }
  return false;
}

export async function loadLocalImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function encode(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== mime) reject(new Error('浏览器无法转换该图片格式'));
      else resolve(blob);
    }, mime, IMAGE_QUALITY);
  });
}

async function imageOutputMime(blob: Blob, kind: ImageAssetKind): Promise<'image/png' | 'image/jpeg' | 'image/webp'> {
  if (kind === 'icon' || blob.type === 'image/svg+xml' || await animatedWebp(blob)) return 'image/png';
  return blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
}

export async function prepareImage(input: {
  readonly blob: Blob;
  readonly kind: ImageAssetKind;
}): Promise<NewImageAsset> {
  const { blob, kind } = input;
  validateImageFile(blob);
  const svg = blob.type === 'image/svg+xml';
  const vector = svg ? await prepareSvgImage(blob) : null;
  const image = vector ? await loadLocalImage(vector.blob) : await createImageBitmap(blob);
  try {
    const size = imageOutputSize({ width: image.width, height: image.height, kind, svg });
    if (kind === 'icon' && vector) return { kind, ...size, mime: 'image/svg+xml', blob: vector.blob, sourceUrl: null };
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) fail('浏览器无法创建图片画布');
    context.drawImage(image, 0, 0, size.width, size.height);
    const mime = await imageOutputMime(blob, kind);
    return { kind, ...size, mime, blob: await encode(canvas, mime), sourceUrl: null };
  } finally {
    if (image instanceof ImageBitmap) image.close();
  }
}

export async function photoSeed(blob: Blob, sourceWidth: number, sourceHeight: number): Promise<string> {
  const scale = Math.min(1, PHOTO_SEED_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const image = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  try {
    if (!context) fail('无法创建照片取色画布');
    context.drawImage(image, 0, 0, width, height);
    const { data } = context.getImageData(0, 0, width, height);
    const pixels: number[] = [];
    for (let index = 0; index < data.length; index += RGBA_CHANNELS) {
      if (data[index + ALPHA_CHANNEL] === OPAQUE_ALPHA) {
        pixels.push(argbFromRgb(data[index + RED_CHANNEL]!, data[index + GREEN_CHANNEL]!, data[index + BLUE_CHANNEL]!));
      }
    }
    const color = Score.score(QuantizerCelebi.quantize(pixels, COLOR_QUANTIZATION))[0];
    if (color === undefined) fail('照片没有可用于动态配色的不透明颜色');
    return hexFromArgb(color);
  } finally {
    image.close();
  }
}
