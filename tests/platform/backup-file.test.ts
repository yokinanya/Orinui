import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createDefaultSettings } from '@/domain/settings';
import { BACKUP_VERSION } from '@/domain/backup';
import type { MediaAsset } from '@/domain/asset';
import { readBackupFile, serializeBackup } from '@/platform/backup-file';
import type { BackupSnapshot } from '@/storage/backup';

vi.mock('@/platform/media', () => ({ validateStoredMediaAsset: async (asset: MediaAsset) => asset }));

const MEDIA_BYTES = new TextEncoder().encode('raw media payload');

async function mediaDigest(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fileFromBytes(bytes: Uint8Array): File {
  return Object.assign(new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' }), { name: 'backup.zip' }) as File;
}

function archive(manifest: Record<string, unknown>, entries: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({ 'manifest.json': strToU8(JSON.stringify(manifest)), ...entries }, { level: 0 });
}

async function manifestFor(media: MediaAsset, bytes: Uint8Array = MEDIA_BYTES, includeName = true): Promise<Record<string, unknown>> {
  const settings = createDefaultSettings();
  const asset = { id: media.id, kind: media.kind, mime: media.mime, width: media.width, height: media.height,
    sourceUrl: media.sourceUrl, ...(includeName ? { name: media.name ?? null } : {}),
    motion: media.motion ? { kind: media.motion.kind, duration: media.motion.duration } : null,
    byteLength: bytes.length, sha256: await mediaDigest(bytes) };
  return { formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    folders: [{ id: 'main', name: '常用', order: 0 }],
    shortcuts: [{ id: 'shortcut', folderId: 'main', title: '网站', url: 'https://example.com/',
      icon: media.kind === 'icon' ? { kind: 'asset', assetId: media.id } : { kind: 'letter' },
      iconSourceUrl: media.kind === 'icon' ? media.sourceUrl : null, order: 0 }],
    settings: media.kind === 'background'
      ? { ...settings, appearance: { ...settings.appearance, background: { kind: 'motion', assetId: media.id, maskStrength: 0.5 } } }
      : settings,
    assets: [asset] };
}

function iconAsset(blob = new Blob([MEDIA_BYTES], { type: 'image/png' })): MediaAsset {
  return { id: 'icon', kind: 'icon', mime: 'image/png', width: 10, height: 10, sourceUrl: null, blob };
}

describe('ZIP backup file', () => {
  it('round-trips manifest and media binary without embedding Base64', async () => {
    const asset = iconAsset();
    const snapshot: BackupSnapshot = { formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
      folders: [{ id: 'main', name: '常用', order: 0 }],
      shortcuts: [{ id: 'shortcut', folderId: 'main', title: '网站', url: 'https://example.com/',
        icon: { kind: 'asset', assetId: asset.id }, iconSourceUrl: null, order: 0 }],
      settings: createDefaultSettings(), assets: [asset] };
    const zipped = await serializeBackup(snapshot);
    const restored = await readBackupFile(fileFromBytes(new Uint8Array(await zipped.arrayBuffer())));
    expect(zipped.type).toBe('application/zip');
    expect(restored.document.assets[0]).not.toHaveProperty('data');
    expect(await restored.assets[0]?.blob.text()).toBe(await asset.blob.text());
  });

  it('round-trips motion metadata and omits its locally rebuilt poster', async () => {
    const settings = createDefaultSettings();
    const asset: MediaAsset = { id: 'wallpaper', kind: 'background', mime: 'video/mp4', width: 1920, height: 1080,
      sourceUrl: null, blob: new Blob([MEDIA_BYTES], { type: 'video/mp4' }),
      motion: { kind: 'video', duration: 2, poster: new Blob(['poster'], { type: 'image/jpeg' }) } };
    const snapshot: BackupSnapshot = { formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
      folders: [{ id: 'main', name: '常用', order: 0 }],
      shortcuts: [], settings: { ...settings, appearance: { ...settings.appearance,
        background: { kind: 'motion', assetId: asset.id, maskStrength: 0.5 } } }, assets: [asset] };
    const restored = await readBackupFile(fileFromBytes(new Uint8Array(await (await serializeBackup(snapshot)).arrayBuffer())));
    expect(restored.document.assets[0]?.motion).toEqual({ kind: 'video', duration: 2 });
    expect(restored.assets[0]?.motion).not.toHaveProperty('poster');
  });
});

describe('ZIP folder wire boundary', () => {
  it('imports current folder format and rejects legacy group formats', async () => {
    const snapshot: BackupSnapshot = { formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
      folders: [{ id: 'work', name: '工作', order: 0 }], shortcuts: [], settings: createDefaultSettings(), assets: [] };
    const zipped = await serializeBackup(snapshot);
    const restored = await readBackupFile(fileFromBytes(new Uint8Array(await zipped.arrayBuffer())));
    expect(restored.document.folders).toEqual([{ id: 'work', name: '工作', order: 0 }]);

    const legacyGroup = { formatVersion: 7, exportedAt: new Date().toISOString(),
      groups: [{ id: 'legacy', name: '常用', colorRole: 'primary', order: 0, isDefault: true }],
      shortcuts: [], settings: createDefaultSettings(), assets: [] };
    await expect(readBackupFile(fileFromBytes(archive(legacyGroup)))).rejects.toThrow(/清单字段不正确/);
  });
});
describe('ZIP integrity', () => {
  it('rejects truncated archives, missing resources, incorrect digests, and CRC damage', async () => {
    const asset = iconAsset();
    const manifest = await manifestFor(asset);
    const validEntries = { 'assets/icon': MEDIA_BYTES };
    const validArchive = archive(manifest, validEntries);
    const brokenCrc = validArchive.slice();
    const payloadOffset = findBytes(brokenCrc, MEDIA_BYTES);
    brokenCrc[payloadOffset] = (brokenCrc[payloadOffset] ?? 0) ^ 0xff;
    const badDigestManifest = { ...manifest, assets: [{ ...(manifest.assets as Array<Record<string, unknown>>)[0], sha256: 'f'.repeat(64) }] };
    await expect(readBackupFile(fileFromBytes(validArchive.subarray(0, validArchive.length - 22)))).rejects.toThrow(/中央目录结束/);
    await expect(readBackupFile(fileFromBytes(archive(manifest)))).rejects.toThrow(/条目与清单资源不匹配/);
    await expect(readBackupFile(fileFromBytes(archive(badDigestManifest, validEntries)))).rejects.toThrow(/摘要校验/);
    await expect(readBackupFile(fileFromBytes(brokenCrc))).rejects.toThrow(/CRC 校验/);
  });

  it('rejects extra paths and unsupported format versions', async () => {
    const manifest = await manifestFor(iconAsset());
    const entries = { 'assets/icon': MEDIA_BYTES, 'assets/other': MEDIA_BYTES };
    await expect(readBackupFile(fileFromBytes(archive(manifest, entries)))).rejects.toThrow(/未声明的条目|不匹配/);
    await expect(readBackupFile(fileFromBytes(archive({ ...manifest, formatVersion: BACKUP_VERSION + 1 }, { 'assets/icon': MEDIA_BYTES }))))
      .rejects.toThrow(/版本不受支持|版本不兼容/);
  });

  it('requires the manifest first and rejects media exceeding its declared size during streaming', async () => {
    const manifest = await manifestFor(iconAsset());
    const assetFirst = zipSync({ 'assets/icon': MEDIA_BYTES, 'manifest.json': strToU8(JSON.stringify(manifest)) }, { level: 0 });
    const oversized = archive(manifest, { 'assets/icon': new TextEncoder().encode('larger media content') });
    await expect(readBackupFile(fileFromBytes(assetFirst))).rejects.toThrow(/清单必须为首个条目/);
    await expect(readBackupFile(fileFromBytes(oversized))).rejects.toThrow(/超过清单大小/);
  });
});

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let offset = 0; offset <= haystack.length - needle.length; offset += 1) {
    if (needle.every((byte, index) => haystack[offset + index] === byte)) return offset;
  }
  throw new Error('ZIP 测试资源未找到');
}
