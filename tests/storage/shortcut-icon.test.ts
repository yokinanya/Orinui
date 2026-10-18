import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseShortcutIcon, shortcutIconOccupancy } from '@/domain/shortcut-icon';
import { BACKUP_VERSION } from '@/domain/backup';
import { readBackupFile, serializeBackup } from '@/platform/backup-file';
import { createDatabase, type Database } from '@/storage/db';
import { createFolder } from '@/storage/folders';
import { ensureInitialized } from '@/storage/init';
import { createBackupSnapshot, replaceAllData } from '@/storage/backup';
import { createShortcut, deleteShortcut, restoreShortcut, updateShortcut } from '@/storage/shortcuts';

vi.mock('@/platform/media', () => ({ validateStoredMediaAsset: async (asset: unknown) => asset }));

let db: Database;
let folderId: string;
beforeEach(async () => {
  db = createDatabase(`shortcut-icon-${crypto.randomUUID()}`);
  await ensureInitialized(db);
  folderId = (await createFolder(db, '测试')).id;
});
afterEach(async () => { db.close(); await db.delete(); });

const image = () => ({ kind: 'icon' as const, mime: 'image/png' as const, width: 10, height: 10,
  blob: new Blob(['pixels'], { type: 'image/png' }) });
const svgImage = () => ({ kind: 'icon' as const, mime: 'image/svg+xml' as const, width: 512, height: 512,
  blob: new Blob(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><path d="M0 0h512v512H0z"/></svg>'],
    { type: 'image/svg+xml' }) });

it('persists occupancy across icon variants, image replacement, and delete undo', async () => {
  const letter = await createShortcut(db, { folderId, title: '文字', url: 'letter.example', icon: { kind: 'letter', occupancy: 75 } });
  const builtIn = await createShortcut(db, { folderId, title: '内置', url: 'built-in.example', icon: { kind: 'built-in', iconId: 'heart', occupancy: 62 } });
  let uploaded = await createShortcut(db, { folderId, title: '上传', url: 'upload.example', icon: { kind: 'letter', occupancy: 80 }, image: image() });
  expect(shortcutIconOccupancy((await db.shortcuts.get(letter.id))!.icon)).toBe(75);
  expect(await db.shortcuts.get(builtIn.id)).toMatchObject({ icon: { kind: 'built-in', iconId: 'heart', occupancy: 62 } });
  expect(await db.shortcuts.get(uploaded.id)).toMatchObject({ icon: { kind: 'asset', occupancy: 80 } });

  uploaded = await updateShortcut(db, uploaded.id, { icon: { ...uploaded.icon, occupancy: 92 }, image: image() });
  expect(uploaded.icon).toMatchObject({ kind: 'asset', occupancy: 92 });
  const removed = await deleteShortcut(db, uploaded.id);
  await restoreShortcut(db, removed);
  expect((await db.shortcuts.get(uploaded.id))?.icon).toEqual(uploaded.icon);
  expect(shortcutIconOccupancy((await db.shortcuts.get(uploaded.id))!.icon)).toBe(92);
});

it('restores icon occupancy through the ZIP backup', async () => {
  await createShortcut(db, { folderId, title: '备份', url: 'backup.example', icon: { kind: 'built-in', iconId: 'book', occupancy: 75 } });
  const snapshot = await createBackupSnapshot(db);
  const serialized = await serializeBackup(snapshot);
  const imported = await readBackupFile(zipFile(serialized));
  expect(imported.document.formatVersion).toBe(BACKUP_VERSION);
  await replaceAllData(db, { document: imported.document, assets: imported.assets });
  expect(shortcutIconOccupancy((await db.shortcuts.toArray())[0]!.icon)).toBe(75);
});

it('normalizes the previous stored shortcut icon size field', async () => {
  expect(parseShortcutIcon({ kind: 'letter', size: 32 })).toEqual({ kind: 'letter', occupancy: 67 });
});

it('uses default occupancy for stored legacy shortcut records without either value', async () => {
  await db.shortcuts.add({ id: 'legacy', folderId, title: '旧记录', url: 'legacy.example',
    icon: { kind: 'letter' }, iconSourceUrl: null, order: 0 });
  expect(shortcutIconOccupancy((await db.shortcuts.get('legacy'))!.icon)).toBe(75);
});

it('stores SVG color on vector icons, preserves it when omitted, and clears it explicitly', async () => {
  let shortcut = await createShortcut(db, { folderId, title: 'SVG', url: 'svg.example',
    icon: { kind: 'letter', occupancy: 84 }, svgColor: '#12abef', image: svgImage() });
  expect(shortcut.icon).toMatchObject({ kind: 'asset', occupancy: 84, color: '#12abef' });
  expect(await db.assets.get(shortcut.icon.kind === 'asset' ? shortcut.icon.assetId : '')).toMatchObject({ mime: 'image/svg+xml' });
  shortcut = await updateShortcut(db, shortcut.id, { title: '保留颜色' });
  expect(shortcut.icon).toMatchObject({ occupancy: 84, color: '#12abef' });
  shortcut = await updateShortcut(db, shortcut.id, { svgColor: null });
  expect(shortcut.icon).toMatchObject({ kind: 'asset', occupancy: 84 });
  expect(shortcut.icon).not.toHaveProperty('color');
  await expect(createShortcut(db, { folderId, title: 'PNG', url: 'png.example', svgColor: '#12abef', image: image() }))
    .rejects.toThrow(/只能用于 SVG/);
  await expect(createShortcut(db, { folderId, title: '无资源', url: 'none.example', svgColor: '#12abef' }))
    .rejects.toThrow(/只能用于 SVG/);
});

it('exports and restores SVG media and icon color through ZIP backup', async () => {
  const shortcut = await createShortcut(db, { folderId, title: 'SVG备份', url: 'svg-backup.example',
    svgColor: '#abcdef', image: svgImage() });
  const snapshot = await createBackupSnapshot(db);
  const serialized = await serializeBackup(snapshot);
  const imported = await readBackupFile(zipFile(serialized));
  expect(imported.document.assets[0]?.mime).toBe('image/svg+xml');
  expect(imported.document.shortcuts.find(({ id }) => id === shortcut.id)?.icon).toMatchObject({ color: '#abcdef' });
  await replaceAllData(db, { document: imported.document, assets: imported.assets });
  expect(await db.shortcuts.get(shortcut.id)).toMatchObject({ icon: { kind: 'asset', color: '#abcdef' } });
});

function zipFile(blob: Blob): File {
  return Object.assign(blob, { name: 'backup.zip' }) as File;
}
