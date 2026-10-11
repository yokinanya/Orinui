import { hexFromArgb, sourceColorFromImage } from '@material/material-color-utilities';

import type { ImageAssetKind } from '@/domain/asset';
import { fail } from '@/domain/errors';
import { imageOutputSize, validateImageFile, SVG_EDGE_LIMIT } from '@/domain/image';
import { validateSvg } from '@/platform/svg';
import type { NewImageAsset } from '@/storage/assets';

const IMAGE_QUALITY = 0.9;
const ANIMATION_CHUNK = 'ANIM';
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

async function svgBitmap(blob: Blob): Promise<HTMLImageElement> {
  const root = validateSvg(await blob.text());
  const box = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  const rawWidth = root.getAttribute('width');
  const rawHeight = root.getAttribute('height');
  const width = rawWidth === null ? box?.[2] : Number(rawWidth.replace(/px$/, ''));
  const height = rawHeight === null ? box?.[3] : Number(rawHeight.replace(/px$/, ''));
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    fail('SVG 需要有效的尺寸或 viewBox，请改用 PNG/WebP');
  }
  const ratio = Math.min(1, SVG_EDGE_LIMIT / Math.max(width, height));
  root.setAttribute('width', String(Math.max(1, Math.round(width * ratio))));
  root.setAttribute('height', String(Math.max(1, Math.round(height * ratio))));
  return loadLocalImage(new Blob([new XMLSerializer().serializeToString(root)], { type: 'image/svg+xml' }));
}

function encode(canvas: HTMLCanvasElement, mime: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob || blob.type !== mime) reject(new Error('浏览器无法转换该图片格式'));
      else resolve(blob);
    }, mime, IMAGE_QUALITY);
  });
}

export async function prepareImage(input: {
  readonly blob: Blob;
  readonly kind: ImageAssetKind;
}): Promise<NewImageAsset> {
  const { blob, kind } = input;
  validateImageFile(blob);
  const svg = blob.type === 'image/svg+xml';
  const image = svg ? await svgBitmap(blob) : await createImageBitmap(blob);
  try {
    const size = imageOutputSize({ width: image.width, height: image.height, kind, svg });
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) fail('浏览器无法创建图片画布');
    context.drawImage(image, 0, 0, size.width, size.height);
    const mime = kind === 'icon' || svg || await animatedWebp(blob)
      ? 'image/png' : blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    return { kind, ...size, mime, blob: await encode(canvas, mime), sourceUrl: null };
  } finally {
    if (image instanceof ImageBitmap) image.close();
  }
}

export async function photoSeed(blob: Blob): Promise<string> {
  return hexFromArgb(await sourceColorFromImage(await loadLocalImage(blob)));
}
