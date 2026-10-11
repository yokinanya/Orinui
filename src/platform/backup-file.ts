import { fail } from '@/domain/errors';
import { BACKUP_IMAGE_LIMIT, BACKUP_JSON_LIMIT, parseBackup, type BackupDocument, type BackupPreview } from '@/domain/backup';
import type { ImageAsset } from '@/domain/asset';
import { imageOutputSize } from '@/domain/image';
import { animatedWebp } from '@/platform/images';
import type { BackupSnapshot } from '@/storage/backup';

const BASE64_CHUNK_BYTES = 32 * 1024;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + BASE64_CHUNK_BYTES, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function serializeAsset(asset: ImageAsset) {
  return { id: asset.id, kind: asset.kind, mime: asset.mime, width: asset.width, height: asset.height,
    sourceUrl: asset.sourceUrl, data: base64(new Uint8Array(await asset.blob.arrayBuffer())) };
}

export async function serializeBackup(snapshot: BackupSnapshot): Promise<Blob> {
  const assets = await Promise.all(snapshot.assets.map(serializeAsset));
  const document = parseBackup({ ...snapshot, assets }).document;
  const json = JSON.stringify(document);
  if (new TextEncoder().encode(json).byteLength > BACKUP_JSON_LIMIT) fail('JSON 备份超过 70 MiB');
  return new Blob([json], { type: 'application/json' });
}

function bytesFromBase64(data: string): Uint8Array {
  const binary = atob(data);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function hasMimeSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/png') return [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  return String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
}

async function restoreAsset(input: BackupDocument['assets'][number]): Promise<ImageAsset> {
  const bytes = bytesFromBase64(input.data);
  validateRestoredAssetBytes(input, bytes);
  const buffer = new Uint8Array(bytes.length);
  buffer.set(bytes);
  const blob = new Blob([buffer.buffer], { type: input.mime });
  await validateStaticWebp(input, blob);
  await validateRestoredDimensions(input, blob);
  return { id: input.id, kind: input.kind, mime: input.mime, width: input.width,
    height: input.height, sourceUrl: input.sourceUrl, blob };
}

function validateRestoredAssetBytes(input: BackupDocument['assets'][number], bytes: Uint8Array): void {
  if (!hasMimeSignature(bytes, input.mime)) fail('图片内容与其格式不一致');
  if (input.mime === 'image/png' && pngHasAnimation(bytes)) fail('备份中的 PNG 必须是静态图片');
}

async function validateStaticWebp(input: BackupDocument['assets'][number], blob: Blob): Promise<void> {
  if (input.mime === 'image/webp' && await animatedWebp(blob)) fail('备份中的 WebP 必须是静态图片');
}

async function validateRestoredDimensions(input: BackupDocument['assets'][number], blob: Blob): Promise<void> {
  const bitmap = await createImageBitmap(blob);
  try {
    const size = imageOutputSize({ width: bitmap.width, height: bitmap.height, kind: input.kind });
    if (size.width !== bitmap.width || size.height !== bitmap.height || bitmap.width !== input.width || bitmap.height !== input.height) {
      fail('图片尺寸与备份记录不一致');
    }
  } finally { bitmap.close(); }
}

function pngHasAnimation(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type === 'acTL') return true;
    offset += view.getUint32(offset) + 12;
  }
  return false;
}

export interface RestorableBackup extends BackupPreview {
  readonly images: readonly ImageAsset[];
}

export async function readBackupFile(file: File): Promise<RestorableBackup> {
  if (file.size > BACKUP_JSON_LIMIT) fail('备份文件超过 70 MiB');
  if (file.type !== '' && file.type !== 'application/json' && !file.name.toLowerCase().endsWith('.json')) fail('请选择 JSON 备份文件');
  const source = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch (cause) { throw new Error(`JSON 文件格式不正确：${cause instanceof Error ? cause.message : String(cause)}`); }
  const preview = parseBackup(parsed);
  const images = await Promise.all(preview.document.assets.map(restoreAsset));
  const total = images.reduce((sum, image) => sum + image.blob.size, 0);
  if (total > BACKUP_IMAGE_LIMIT) fail('图片资源总量超过 50 MiB');
  return { ...preview, images };
}
