import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSyncCrypto } from '@/platform/sync-crypto';
import { decodeSyncSnapshot, encodeSyncSnapshot, openSyncImage } from '@/platform/sync-codec';
import { mergeSyncSnapshots } from '@/domain/sync';
import { createDatabase, type Database } from '@/storage/db';
import { ensureInitialized } from '@/storage/init';
import { createShortcut, updateShortcut } from '@/storage/shortcuts';
import { createBackupSnapshot, replaceAllData, resetLocalData } from '@/storage/backup';
import { initializeSyncVault, readSyncKey } from '@/storage/sync/vault';
import { exportSyncSnapshot } from '@/storage/sync/export';
import { sealSyncExport } from '@/storage/sync/encrypted';
import { planSyncJoin } from '@/storage/sync/join-plan';
import { applySyncSnapshot } from '@/storage/sync/apply';
import { setMotionBackground } from '@/storage/image-operations';
import type { MediaAsset } from '@/domain/asset';
import { BACKUP_VERSION, type BackupDocument } from '@/domain/backup';

const cipher = createSyncCrypto(webcrypto as unknown as Crypto);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j+L8AAAAASUVORK5CYII=';
const PNG_HEADER = [137, 80, 78, 71, 13, 10, 26, 10];
let first: Database;
let second: Database;

beforeEach(() => {
  first = createDatabase(`exchange-a-${crypto.randomUUID()}`);
  second = createDatabase(`exchange-b-${crypto.randomUUID()}`);
});
afterEach(async () => { await Promise.all([first.delete(), second.delete()]); });

async function verifyFixtureImage(asset: MediaAsset): Promise<void> {
  const bytes = new Uint8Array(await asset.blob.arrayBuffer());
  if (asset.mime === 'image/svg+xml') {
    expect(new TextDecoder().decode(bytes)).toContain('<svg');
    expect(asset.width).toBe(512);
    expect(asset.height).toBe(512);
    return;
  }
  expect([...bytes.slice(0, PNG_HEADER.length)]).toEqual(PNG_HEADER);
  expect(asset.width).toBe(1);
  expect(asset.height).toBe(1);
}

async function seedFirstDevice() {
  const { defaultGroup } = await ensureInitialized(first);
  const image = new Blob([Uint8Array.from(atob(PNG), (character) => character.charCodeAt(0))], { type: 'image/png' });
  const shortcut = await createShortcut(first, { groupId: defaultGroup.id, title: '共有网站', url: 'https://example.com',
    icon: { kind: 'letter', occupancy: 71 },
    iconSourceUrl: 'https://images.example.com/icon.png',
    image: { kind: 'icon', mime: 'image/png', width: 1, height: 1, blob: image, sourceUrl: 'https://images.example.com/icon.png' } });
  const svgImage = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/></svg>'],
    { type: 'image/svg+xml' });
  const svgShortcut = await createShortcut(first, { groupId: defaultGroup.id, title: 'SVG 图标', url: 'https://svg.example.com',
    icon: { kind: 'letter', occupancy: 88 }, svgColor: '#12abef',
    image: { kind: 'icon', mime: 'image/svg+xml', width: 512, height: 512, blob: svgImage } });
  const material = await cipher.createKey();
  await initializeSyncVault(first, { vaultId: 'vault', deviceId: 'a', key: material.key });
  await initializeSyncVault(second, { vaultId: 'vault', deviceId: 'b', key: await cipher.importKey(material.recoveryKey) });
  return { shortcut, svgShortcut };
}

async function openRemoteAssets(snapshot: ReturnType<typeof decodeSyncSnapshot>, sealed: Awaited<ReturnType<typeof sealSyncExport>>, key: CryptoKey): Promise<MediaAsset[]> {
  const assets: MediaAsset[] = [];
  for (const asset of snapshot.assets) {
    const encrypted = sealed.assets.find(({ id }) => id === asset.id);
    if (!encrypted) throw new Error(`缺少媒体密文：${asset.id}`);
    assets.push(await openSyncImage({ crypto: cipher, key, vaultId: snapshot.vaultId, asset, ciphertext: encrypted.ciphertext }));
  }
  return assets;
}

async function receiveRemoteSnapshot(input: {
  readonly database: Database;
  readonly local: Awaited<ReturnType<typeof exportSyncSnapshot>>;
  readonly remote: ReturnType<typeof decodeSyncSnapshot>;
  readonly assets: readonly MediaAsset[];
}): Promise<void> {
  await applySyncSnapshot(input.database, { snapshot: planSyncJoin({ local: input.local.snapshot, remotes: [input.remote] }),
    assets: input.assets, expectedGeneration: input.local.localGeneration }, { crypto: cipher,
    validateStoredMediaAsset: async (asset) => { await verifyFixtureImage(asset); return asset; } });
}

async function mergeIndependentEdits(id: string): Promise<void> {
  await updateShortcut(first, id, { title: '设备 A 标题' });
  await updateShortcut(second, id, { url: 'https://example.com/new' });
  const a = await exportSyncSnapshot(first, cipher);
  const b = await exportSyncSnapshot(second, cipher);
  await applySyncSnapshot(first, { snapshot: mergeSyncSnapshots({ local: a.snapshot, remotes: [b.snapshot] }),
    assets: a.assets, expectedGeneration: a.localGeneration }, { crypto: cipher,
    validateStoredMediaAsset: async (asset) => { await verifyFixtureImage(asset); return asset; } });
}

describe('provider-independent encrypted device exchange', () => {
  it('authenticates snapshot and photo bytes, joins an empty device and combines independent edits', async () => {
    const { shortcut, svgShortcut } = await seedFirstDevice();
    const sealed = await sealSyncExport(first, { crypto: cipher, encodeSnapshot: encodeSyncSnapshot });
    const captured = await exportSyncSnapshot(first, cipher);
    assertExportedIcons(captured.snapshot.shortcuts, shortcut.id, svgShortcut.id);
    const key = await readSyncKey(second, 'vault');
    const context = { vaultId: 'vault', kind: 'snapshot' as const, objectId: sealed.snapshot.id };
    const remote = decodeSyncSnapshot(await cipher.decrypt({ key, context, ciphertext: sealed.snapshot.ciphertext }), context);
    const local = await exportSyncSnapshot(second, cipher);
    const media = await openRemoteAssets(remote, sealed, key);
    await receiveRemoteSnapshot({ database: second, local, remote, assets: media });
    await expectImportedIcons(shortcut.id, svgShortcut.id);
    await mergeIndependentEdits(shortcut.id);
    expect(await first.shortcuts.get(shortcut.id)).toMatchObject({ title: '设备 A 标题', url: 'https://example.com/new' });
  });

  it('preserves nonempty local data as an ordinary group on first joining', async () => {
    const { shortcut } = await seedFirstDevice();
    const localGroup = (await second.groups.toArray())[0]!;
    await createShortcut(second, { groupId: localGroup.id, title: '本机网站', url: 'https://local.example.com' });
    const local = await exportSyncSnapshot(second, cipher);
    const remote = await exportSyncSnapshot(first, cipher);
    const joined = planSyncJoin({ local: local.snapshot, remotes: [remote.snapshot] });
    await applySyncSnapshot(second, { snapshot: joined, assets: remote.assets,
      expectedGeneration: local.localGeneration }, { crypto: cipher, validateStoredMediaAsset: async (asset) => { await verifyFixtureImage(asset); return asset; } });
    expect(await second.groups.count()).toBe(2);
    expect((await second.groups.get(localGroup.id))?.isDefault).toBe(false);
    expect((await second.shortcuts.toArray()).map(({ title }) => title).sort()).toEqual(['SVG 图标', '共有网站', '本机网站']);
    expect(await second.shortcuts.get(shortcut.id)).toBeDefined();
  });

  it('encrypts dynamic media without its poster and rebuilds the local poster on receipt', async () => {
    const exchange = await prepareMotionExchange();
    expect(exchange.metadata.motion).toEqual({ kind: 'video', duration: 8 });
    expect(exchange.metadata).not.toHaveProperty('motion.poster');
    const { encrypted } = await applyMotionExchange(exchange);
    const applied = (await second.assets.toArray())[0];
    expect(applied?.motion?.poster?.type).toBe('image/png');
    expect(await applied?.motion?.poster?.text()).toBe('rebuilt poster');
    expect((await second.settings.get('app'))?.appearance.background.kind).toBe('motion');
    const tampered = encrypted.ciphertext.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 1;
    await expect(openSyncImage({ crypto: cipher, key: exchange.key, vaultId: 'motion-vault',
      asset: exchange.metadata, ciphertext: tampered })).rejects.toThrow();
  });
});

function assertExportedIcons(shortcuts: readonly { readonly id: string; readonly icon: { readonly value: unknown } }[], firstId: string, secondId: string): void {
  const firstIcon = shortcuts.find(({ id }) => id === firstId)?.icon.value;
  expect(firstIcon).toMatchObject({ kind: 'asset', occupancy: 71 });
  expect(shortcuts.find(({ id }) => id === secondId)?.icon.value).toMatchObject({ kind: 'asset', occupancy: 88, color: '#12abef' });
}

async function expectImportedIcons(firstId: string, secondId: string): Promise<void> {
  expect(await second.shortcuts.get(firstId)).toMatchObject({ icon: { kind: 'asset', occupancy: 71 }, iconSourceUrl: 'https://images.example.com/icon.png' });
  expect(await second.shortcuts.get(secondId)).toMatchObject({ icon: { kind: 'asset', occupancy: 88, color: '#12abef' } });
  expect(await second.groups.count()).toBe(1);
}

async function prepareMotionExchange() {
  await ensureInitialized(first);
  await ensureInitialized(second);
  await setMotionBackground(first, { kind: 'background', mime: 'video/webm', width: 1280, height: 720,
    blob: new Blob(['dynamic video bytes'], { type: 'video/webm' }), sourceUrl: null,
    motion: { kind: 'video', duration: 8, poster: new Blob(['initial poster'], { type: 'image/png' }) } });
  const keyMaterial = await cipher.createKey();
  await initializeSyncVault(first, { vaultId: 'motion-vault', deviceId: 'motion-a', key: keyMaterial.key });
  await initializeSyncVault(second, { vaultId: 'motion-vault', deviceId: 'motion-b', key: await cipher.importKey(keyMaterial.recoveryKey) });
  const sealed = await sealSyncExport(first, { crypto: cipher, encodeSnapshot: encodeSyncSnapshot });
  const local = await exportSyncSnapshot(second, cipher);
  const key = await readSyncKey(second, 'motion-vault');
  const context = { vaultId: 'motion-vault', kind: 'snapshot' as const, objectId: sealed.snapshot.id };
  const remote = decodeSyncSnapshot(await cipher.decrypt({ key, context, ciphertext: sealed.snapshot.ciphertext }), context);
  const metadata = remote.assets[0];
  const encrypted = sealed.assets[0];
  if (!metadata || !encrypted) throw new Error('动态背景同步对象缺失');
  return { sealed, local, remote, key, metadata, encrypted };
}

async function applyMotionExchange(exchange: Awaited<ReturnType<typeof prepareMotionExchange>>) {
  const opened = await openSyncImage({ crypto: cipher, key: exchange.key, vaultId: 'motion-vault',
    asset: exchange.metadata, ciphertext: exchange.encrypted.ciphertext });
    const poster = new Blob(['rebuilt poster'], { type: 'image/png' });
  await applySyncSnapshot(second, { snapshot: planSyncJoin({ local: exchange.local.snapshot, remotes: [exchange.remote] }),
    assets: [opened], expectedGeneration: exchange.local.localGeneration }, { crypto: cipher,
    validateStoredMediaAsset: async (asset) => ({ ...asset, motion: { ...asset.motion!, poster } }) });
  return { encrypted: exchange.encrypted };
}

describe('explicit full replacements with sync metadata', () => {
  it('remaps previously registered IDs and propagates tombstones without restoring old identities', async () => {
    const initial = await ensureInitialized(first);
    const old = await createShortcut(first, { groupId: initial.defaultGroup.id, title: '备份网站', url: 'https://example.com' });
    await initializeSyncVault(first, { vaultId: 'vault', deviceId: 'a', key: (await cipher.createKey()).key });
    const saved = await createBackupSnapshot(first);
    const document: BackupDocument = { ...saved, formatVersion: BACKUP_VERSION, assets: [] };
    await replaceAllData(first, { document, assets: [] });
    const restored = (await first.shortcuts.toArray())[0]!;
    expect(restored.id).not.toBe(old.id);
    expect(restored.title).toBe(old.title);
    const exported = await exportSyncSnapshot(first, cipher);
    expect(exported.snapshot.tombstones).toContainEqual(expect.objectContaining({ entityType: 'shortcut', id: old.id }));
    expect(await first.sync_keys.count()).toBe(1);
    await resetLocalData(first);
    const reset = await exportSyncSnapshot(first, cipher);
    expect(reset.snapshot.shortcuts).toHaveLength(0);
    expect(reset.snapshot.tombstones).toContainEqual(expect.objectContaining({ entityType: 'shortcut', id: restored.id }));
  });
});
