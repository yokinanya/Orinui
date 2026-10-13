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
import type { ImageAsset } from '@/domain/asset';
import type { BackupDocument } from '@/domain/backup';

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

async function verifyFixtureImage(asset: ImageAsset): Promise<void> {
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

describe('provider-independent encrypted device exchange', () => {
  it('authenticates snapshot and photo bytes, joins an empty device and combines independent edits', async () => {
    const { shortcut, svgShortcut } = await seedFirstDevice();
    const sealed = await sealSyncExport(first, { crypto: cipher, encodeSnapshot: encodeSyncSnapshot });
    const captured = await exportSyncSnapshot(first, cipher);
    expect(captured.snapshot.shortcuts.find(({ id }) => id === shortcut.id)?.icon.value).toEqual({
      kind: 'asset', assetId: shortcut.icon.kind === 'asset' ? shortcut.icon.assetId : '', occupancy: 71,
    });
    expect(captured.snapshot.shortcuts.find(({ id }) => id === svgShortcut.id)?.icon.value).toMatchObject({
      kind: 'asset', occupancy: 88, color: '#12abef',
    });
    const key = await readSyncKey(second, 'vault');
    const context = { vaultId: 'vault', kind: 'snapshot' as const, objectId: sealed.snapshot.id };
    const remote = decodeSyncSnapshot(await cipher.decrypt({ key, context, ciphertext: sealed.snapshot.ciphertext }), context);
    const media = await Promise.all(remote.assets.map((asset) => openSyncImage({
      crypto: cipher, key, vaultId: 'vault', asset,
      ciphertext: sealed.assets.find(({ id }) => id === asset.id)!.ciphertext,
    })));
    const local = await exportSyncSnapshot(second, cipher);
    await applySyncSnapshot(second, { snapshot: planSyncJoin({ local: local.snapshot, remotes: [remote] }),
      assets: media, expectedGeneration: local.localGeneration }, { crypto: cipher, validateImage: verifyFixtureImage });
    expect(await second.shortcuts.get(shortcut.id)).toMatchObject({ icon: { kind: 'asset', occupancy: 71 },
      iconSourceUrl: 'https://images.example.com/icon.png' });
    expect(await second.shortcuts.get(svgShortcut.id)).toMatchObject({ icon: { kind: 'asset', occupancy: 88, color: '#12abef' } });
    expect(await second.groups.count()).toBe(1);
    await updateShortcut(first, shortcut.id, { title: '设备 A 标题' });
    await updateShortcut(second, shortcut.id, { url: 'https://example.com/new' });
    const a = await exportSyncSnapshot(first, cipher);
    const b = await exportSyncSnapshot(second, cipher);
    await applySyncSnapshot(first, { snapshot: mergeSyncSnapshots({ local: a.snapshot, remotes: [b.snapshot] }),
      assets: a.assets, expectedGeneration: a.localGeneration }, { crypto: cipher, validateImage: verifyFixtureImage });
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
      expectedGeneration: local.localGeneration }, { crypto: cipher, validateImage: verifyFixtureImage });
    expect(await second.groups.count()).toBe(2);
    expect((await second.groups.get(localGroup.id))?.isDefault).toBe(false);
    expect((await second.shortcuts.toArray()).map(({ title }) => title).sort()).toEqual(['SVG 图标', '共有网站', '本机网站']);
    expect(await second.shortcuts.get(shortcut.id)).toBeDefined();
  });
});

describe('explicit full replacements with sync metadata', () => {
  it('remaps previously registered IDs and propagates tombstones without restoring old identities', async () => {
    const initial = await ensureInitialized(first);
    const old = await createShortcut(first, { groupId: initial.defaultGroup.id, title: '备份网站', url: 'https://example.com' });
    await initializeSyncVault(first, { vaultId: 'vault', deviceId: 'a', key: (await cipher.createKey()).key });
    const saved = await createBackupSnapshot(first);
    const document: BackupDocument = { ...saved, assets: [] };
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
