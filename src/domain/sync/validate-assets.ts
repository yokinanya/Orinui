import { fail } from '@/domain/errors';
import { imageOutputSize } from '@/domain/image';
import { validateRemoteImageUrl } from '@/domain/remote-image-url';
import type { SyncAsset } from '@/domain/sync/types';
import { asRecord, exactKeys, identifier, integer, validateRegister } from '@/domain/sync/validate-common';

const ICON_EDGE_PIXELS = 1024;
const BACKGROUND_EDGE_PIXELS = 2560;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function parseKind(value: unknown): SyncAsset['kind'] {
  if (value !== 'background' && value !== 'icon') fail('图片资源类型不正确');
  return value;
}

function parseMime(value: unknown): SyncAsset['mime'] {
  if (value !== 'image/png' && value !== 'image/jpeg' && value !== 'image/webp' && value !== 'image/svg+xml') fail('图片资源格式不正确');
  return value;
}

function parseDimensions(input: { readonly kind: SyncAsset['kind']; readonly mime: SyncAsset['mime'];
  readonly width: unknown; readonly height: unknown }): { readonly width: number; readonly height: number } {
  if (typeof input.width !== 'number' || typeof input.height !== 'number') fail('图片尺寸不正确');
  if (input.kind === 'icon' && input.mime !== 'image/png' && input.mime !== 'image/svg+xml') fail('网站图标必须是 PNG 或 SVG');
  if (input.kind === 'background' && input.mime === 'image/svg+xml') fail('SVG 不能作为背景图片');
  imageOutputSize({ width: input.width, height: input.height, kind: input.kind });
  const edgeLimit = input.kind === 'icon' ? ICON_EDGE_PIXELS : BACKGROUND_EDGE_PIXELS;
  if (Math.max(input.width, input.height) > edgeLimit) fail('图片最长边超出限制');
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

export function parseSyncAsset(value: unknown): SyncAsset {
  const raw = asRecord(value, '同步图片资源');
  exactKeys(raw, ['id', 'kind', 'mime', 'width', 'height', 'byteLength', 'sha256', 'sourceUrl'], '同步图片资源');
  const kind = parseKind(raw.kind);
  const mime = parseMime(raw.mime);
  const { width, height } = parseDimensions({ kind, mime, width: raw.width, height: raw.height });
  const byteLength = integer(raw.byteLength, '图片大小');
  if (byteLength === 0) fail('图片大小必须大于零');
  return { id: identifier(raw.id, '图片标识'), kind, mime, width, height, byteLength, sha256: parseHash(raw.sha256),
    sourceUrl: validateRegister(raw.sourceUrl, '图片来源', parseSourceUrl) };
}
