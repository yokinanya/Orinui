import { fail } from '@/domain/errors';
import { imageOutputSize } from '@/domain/image';
import { validateRemoteImageUrl } from '@/domain/remote-image-url';
import { normalizeOptionalAssetName } from '@/domain/text';
import { SYNC_SCHEMA_VERSION, type SupportedSyncSchemaVersion, type SyncAsset } from '@/domain/sync/types';
import { asRecord, exactKeys, identifier, integer, validateRegister } from '@/domain/sync/validate-common';

const ICON_EDGE_PIXELS = 1024;
const BACKGROUND_EDGE_PIXELS = 2560;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function parseKind(value: unknown): SyncAsset['kind'] {
  if (value !== 'background' && value !== 'icon') fail('图片资源类型不正确');
  return value as SyncAsset['kind'];
}

function parseMime(value: unknown): SyncAsset['mime'] {
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'video/mp4', 'video/webm'].includes(String(value))) fail('媒体资源格式不正确');
  return value as SyncAsset['mime'];
}

function motionKind(mime: SyncAsset['mime']): 'video' | 'animation' {
  if (mime === 'video/mp4' || mime === 'video/webm') return 'video';
  if (mime === 'image/gif' || mime === 'image/webp') return 'animation';
  return fail('静态媒体不能包含动态元数据');
}

function validateDuration(kind: 'video' | 'animation', value: unknown): number | null {
  if (kind === 'video') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) fail('视频时长不正确');
    return value;
  }
  if (value !== null) fail('动图不保存视频时长');
  return null;
}

function parseMotion(value: unknown, mime: SyncAsset['mime'], kind: SyncAsset['kind']): SyncAsset['motion'] {
  if (value === null) return noMotion(mime);
  const raw = asRecord(value, '动态媒体元数据');
  exactKeys(raw, ['kind', 'duration'], '动态媒体元数据');
  if (kind !== 'background') fail('网站图标不能包含动态媒体');
  const expectedKind = motionKind(mime);
  if (raw.kind !== expectedKind) fail('动态媒体类型与格式不匹配');
  return { kind: expectedKind, duration: validateDuration(expectedKind, raw.duration) };
}

function noMotion(mime: SyncAsset['mime']): null {
  if (mime === 'video/mp4' || mime === 'video/webm' || mime === 'image/gif') fail('动态媒体缺少动态元数据');
  return null;
}

function validateDynamicDimensions(input: { readonly kind: SyncAsset['kind']; readonly width: number; readonly height: number }): void {
  if (input.kind !== 'background') fail('动态媒体只能用作背景');
  if (!Number.isSafeInteger(input.width) || !Number.isSafeInteger(input.height) || input.width <= 0 || input.height <= 0) {
    fail('动态媒体尺寸不正确');
  }
}

function validateStaticDimensions(input: { readonly kind: SyncAsset['kind']; readonly mime: SyncAsset['mime'];
  readonly width: number; readonly height: number }): void {
  if (input.kind === 'icon' && input.mime !== 'image/png' && input.mime !== 'image/svg+xml') fail('网站图标必须是 PNG 或 SVG');
  if (input.kind === 'background' && input.mime === 'image/svg+xml') fail('SVG 不能作为背景图片');
  imageOutputSize(input);
  const edgeLimit = input.kind === 'icon' ? ICON_EDGE_PIXELS : BACKGROUND_EDGE_PIXELS;
  if (Math.max(input.width, input.height) > edgeLimit) fail('图片最长边超出限制');
}

function parseDimensions(input: { readonly kind: SyncAsset['kind']; readonly mime: SyncAsset['mime'];
  readonly width: unknown; readonly height: unknown; readonly motion: unknown }): { readonly width: number; readonly height: number } {
  if (typeof input.width !== 'number' || typeof input.height !== 'number') fail('媒体尺寸不正确');
  const dimensions = { kind: input.kind, mime: input.mime, width: input.width, height: input.height };
  if (input.motion === null) validateStaticDimensions(dimensions);
  else validateDynamicDimensions(dimensions);
  return { width: input.width, height: input.height };
}

function parseHash(value: unknown): string {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) fail('图片 SHA-256 不正确');
  return value;
}

function parseSourceUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') fail('图片来源地址不正确');
  const validated = validateRemoteImageUrl(value);
  if (validated.url.href !== value) fail('图片来源地址格式不规范');
  return value;
}

function parseAssetName(value: unknown): string | null {
  if (value === null) return null;
  const name = normalizeOptionalAssetName(identifier(value, '媒体名称'));
  if (name === '' || name !== value) fail('媒体名称必须是已保存的规范格式');
  return name;
}

export function parseSyncAsset(value: unknown, schemaVersion: SupportedSyncSchemaVersion = SYNC_SCHEMA_VERSION): SyncAsset {
  const raw = asRecord(value, '同步图片资源');
  const keys = ['id', 'kind', 'mime', 'width', 'height', 'byteLength', 'sha256', 'sourceUrl', 'motion'];
  if (schemaVersion >= 10) keys.push('name');
  exactKeys(raw, keys, '同步媒体资源');
  const kind = parseKind(raw.kind);
  const mime = parseMime(raw.mime);
  const motion = parseMotion(raw.motion, mime, kind);
  const { width, height } = parseDimensions({ kind, mime, width: raw.width, height: raw.height, motion });
  const byteLength = integer(raw.byteLength, '媒体大小');
  if (byteLength === 0) fail('媒体大小必须大于零');
  const sourceUrl = validateRegister(raw.sourceUrl, '图片来源', parseSourceUrl);
  if (motion && sourceUrl.value !== null) fail('动态媒体来源必须为空');
  const name = schemaVersion >= 10
    ? validateRegister(raw.name, '素材名称', parseAssetName)
    : { value: null, clock: 0, deviceId: sourceUrl.deviceId };
  return { id: identifier(raw.id, '媒体标识'), kind, mime, width, height, byteLength, sha256: parseHash(raw.sha256),
    sourceUrl, name, motion };
}
