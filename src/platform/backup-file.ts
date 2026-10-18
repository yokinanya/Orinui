import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough, type UnzipFile } from 'fflate';
import { fail } from '@/domain/errors';
import { BACKUP_VERSION, parseBackup, type BackupAsset, type BackupDocument, type BackupPreview } from '@/domain/backup';
import type { MediaAsset } from '@/domain/asset';
import { validateStoredMediaAsset } from '@/platform/media';
import { finishZipCrc, updateZipCrc, validateZipEnd, ZIP_EOCD_SEARCH_BYTES } from '@/platform/backup-zip-integrity';
import type { BackupSnapshot } from '@/storage/backup';

const ZIP_MIME = 'application/zip';
const MANIFEST_PATH = 'manifest.json';
const ASSET_DIRECTORY = 'assets/';
const ASSET_PATH = /^assets\/[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;

interface ZipReadState {
  readonly entries: Map<string, Blob>;
  readonly seen: Set<string>;
  readonly checksums: Map<string, number>;
  manifest: BackupDocument | null;
  error: Error | null;
}

function toAssetMetadata(asset: MediaAsset, sha256: string): BackupAsset {
  return { id: asset.id, kind: asset.kind, mime: asset.mime, width: asset.width, height: asset.height,
    sourceUrl: asset.sourceUrl, name: asset.name ?? null,
    motion: asset.motion ? { kind: asset.motion.kind, duration: asset.motion.duration } : null,
    byteLength: asset.blob.size, sha256 };
}

async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function createManifest(snapshot: BackupSnapshot, assets: readonly BackupAsset[]): BackupDocument {
  return parseBackup({ formatVersion: BACKUP_VERSION, exportedAt: snapshot.exportedAt,
    folders: snapshot.folders, shortcuts: snapshot.shortcuts, settings: snapshot.settings, assets }).document;
}

function zipOutput(): { readonly archive: Zip; readonly chunks: Uint8Array[]; readonly complete: Promise<void> } {
  const chunks: Uint8Array[] = [];
  let resolveComplete!: () => void;
  let rejectComplete!: (error: Error) => void;
  const complete = new Promise<void>((resolve, reject) => { resolveComplete = resolve; rejectComplete = reject; });
  const archive = new Zip((error, chunk, final) => {
    if (error) { rejectComplete(error); return; }
    chunks.push(chunk);
    if (final) resolveComplete();
  });
  return { archive, chunks, complete };
}

function arrayBufferView(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!(bytes.buffer instanceof ArrayBuffer)) fail('ZIP 流返回了不支持的共享缓冲区');
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function blobParts(chunks: readonly Uint8Array[]): BlobPart[] {
  return chunks.map(arrayBufferView);
}

async function addBlob(archive: Zip, path: string, blob: Blob): Promise<void> {
  const entry = new ZipPassThrough(path);
  archive.add(entry);
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      entry.push(part.value);
    }
    entry.push(new Uint8Array(), true);
  } finally {
    reader.releaseLock();
  }
}

export async function serializeBackup(snapshot: BackupSnapshot): Promise<Blob> {
  const metadata: BackupAsset[] = [];
  for (const asset of snapshot.assets) {
    const validated = await validateStoredMediaAsset(asset);
    metadata.push(toAssetMetadata(validated, await sha256(asset.blob)));
  }
  const document = createManifest(snapshot, metadata);
  const output = zipOutput();
  try {
    await addBlob(output.archive, MANIFEST_PATH, new Blob([JSON.stringify(document)], { type: 'application/json' }));
    for (const asset of snapshot.assets) await addBlob(output.archive, `${ASSET_DIRECTORY}${asset.id}`, asset.blob);
    output.archive.end();
    await output.complete;
    return new Blob(blobParts(output.chunks), { type: ZIP_MIME });
  } catch (cause) {
    output.archive.terminate();
    throw cause;
  }
}

function parseManifest(source: string): BackupDocument {
  let input: unknown;
  try { input = JSON.parse(source); }
  catch (cause) { throw new Error(`ZIP 清单格式不正确：${cause instanceof Error ? cause.message : String(cause)}`); }
  try { return parseBackup(input).document; }
  catch (cause) { throw new Error(`ZIP 清单校验失败：${cause instanceof Error ? cause.message : String(cause)}`); }
}

function entryPathAllowed(path: string, state: ZipReadState): void {
  if (state.seen.has(path)) fail(`ZIP 包含重复条目：${path}`);
  state.seen.add(path);
  if (path === MANIFEST_PATH) {
    if (state.manifest) fail('ZIP 包含重复清单');
    return;
  }
  if (!state.manifest) fail('ZIP 清单必须为首个条目');
  if (!ASSET_PATH.test(path)) fail(`ZIP 媒体路径不规范：${path}`);
  const expected = state.manifest.assets.some((asset) => `${ASSET_DIRECTORY}${asset.id}` === path);
  if (!expected) fail(`ZIP 包含未声明的条目：${path}`);
}

function onZipFile(file: UnzipFile, state: ZipReadState): void {
  if (state.error) return;
  try { entryPathAllowed(file.name, state); }
  catch (cause) { state.error = cause instanceof Error ? cause : new Error(String(cause)); return; }
  const chunks: Uint8Array[] = [];
  const manifestAsset = state.manifest?.assets.find((asset) => `${ASSET_DIRECTORY}${asset.id}` === file.name);
  let size = 0;
  let crc = 0xffffffff;
  file.ondata = (error, chunk, final) => {
    if (error) { state.error = error; return; }
    size += chunk.byteLength;
    if (manifestAsset && size > manifestAsset.byteLength) { state.error = new Error(`媒体超过清单大小：${file.name}`); return; }
    crc = updateZipCrc(crc, chunk);
    chunks.push(chunk);
    if (!final) return;
    const result = new Blob(blobParts(chunks));
    state.entries.set(file.name, result);
    state.checksums.set(file.name, finishZipCrc(crc));
    if (file.name === MANIFEST_PATH) {
      try { state.manifest = parseManifest(decodeManifest(chunks, size)); }
      catch (cause) { state.error = cause instanceof Error ? cause : new Error(String(cause)); }
    }
    chunks.length = 0;
  };
  try { file.start(); }
  catch (cause) { state.error = cause instanceof Error ? cause : new Error(String(cause)); }
}

function decodeManifest(chunks: readonly Uint8Array[], size: number): string {
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function readZip(file: File): Promise<ZipReadState> {
  const state: ZipReadState = { entries: new Map(), seen: new Set(), checksums: new Map(), manifest: null, error: null };
  const unzip = new Unzip((entry) => onZipFile(entry, state));
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);
  const reader = file.stream().getReader();
  let tail = new Uint8Array();
  let byteCount = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (!part.done) {
        byteCount += part.value.byteLength;
        tail = appendTail(tail, part.value);
      }
      unzip.push(part.done ? new Uint8Array() : part.value, part.done);
      if (state.error) throw state.error;
      if (part.done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (state.error) throw state.error;
  await validateZipEnd({ file, tail, fileSize: byteCount, checksums: state.checksums });
  return state;
}

function appendTail(current: Uint8Array, next: Uint8Array): Uint8Array<ArrayBuffer> {
  const combined = new Uint8Array(current.length + next.length);
  combined.set(current);
  combined.set(next, current.length);
  return combined.length > ZIP_EOCD_SEARCH_BYTES ? combined.slice(combined.length - ZIP_EOCD_SEARCH_BYTES) : combined;
}

async function restoreAssets(document: BackupDocument, entries: ReadonlyMap<string, Blob>): Promise<MediaAsset[]> {
  const assets: MediaAsset[] = [];
  for (const metadata of document.assets) {
    const path = `${ASSET_DIRECTORY}${metadata.id}`;
    const blob = entries.get(path);
    if (!blob) fail(`ZIP 缺少媒体条目：${path}`);
    if (blob.size !== metadata.byteLength) fail(`媒体大小与清单不一致：${path}`);
    if (!SHA256_HEX.test(metadata.sha256) || await sha256(blob) !== metadata.sha256) fail(`媒体摘要校验失败：${path}`);
    const typedBlob = blob.slice(0, blob.size, metadata.mime);
    assets.push(await validateStoredMediaAsset({ id: metadata.id, kind: metadata.kind, mime: metadata.mime,
      width: metadata.width, height: metadata.height, sourceUrl: metadata.sourceUrl, name: metadata.name, blob: typedBlob,
      ...(metadata.motion ? { motion: metadata.motion } : {}) }));
  }
  return assets;
}

export interface RestorableBackup extends BackupPreview {
  readonly assets: readonly MediaAsset[];
}

export async function readBackupFile(file: File): Promise<RestorableBackup> {
  if (file.type !== ZIP_MIME && !file.name.toLowerCase().endsWith('.zip')) fail('请选择 ZIP 备份文件');
  const archive = await readZip(file);
  if (!archive.manifest) fail('ZIP 缺少 manifest.json 清单');
  const expectedPaths = new Set([MANIFEST_PATH, ...archive.manifest.assets.map((asset) => `${ASSET_DIRECTORY}${asset.id}`)]);
  if (archive.seen.size !== expectedPaths.size || [...expectedPaths].some((path) => !archive.seen.has(path))) fail('ZIP 条目与清单资源不匹配');
  const assets = await restoreAssets(archive.manifest, archive.entries);
  return { ...parseBackup({ formatVersion: archive.manifest.formatVersion, exportedAt: archive.manifest.exportedAt,
    folders: archive.manifest.folders, shortcuts: archive.manifest.shortcuts, settings: archive.manifest.settings,
    assets: archive.manifest.assets }), assets };
}
