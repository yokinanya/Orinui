import { createDefaultSettings } from '@/domain/settings';
import { fail } from '@/domain/errors';
import { newId } from '@/domain/id';
import { SETTINGS_ID, type Database } from '@/storage/db';
import type { MediaAsset } from '@/domain/asset';
import type { Folder } from '@/domain/folder';
import type { Shortcut } from '@/domain/shortcut';
import type { AppSettings } from '@/domain/settings';
import { readSettings } from '@/storage/settings';
import { parseBackup, BACKUP_VERSION, type BackupDocument } from '@/domain/backup';
import { tombstoneReplacedShortcuts } from '@/storage/sync/pending-deletes';
import { prepareSyncReplacement } from '@/storage/sync/backup-replacement';

export interface BackupSnapshot {
  readonly formatVersion: typeof BACKUP_VERSION;
  readonly exportedAt: string;
  readonly folders: readonly Folder[];
  readonly shortcuts: readonly Shortcut[];
  readonly settings: AppSettings;
  readonly assets: readonly MediaAsset[];
}

export async function createBackupSnapshot(db: Database): Promise<BackupSnapshot> {
  const state = await db.transaction('r', db.folders, db.shortcuts, db.settings, db.assets, async () => ({
    folders: await db.folders.toArray(),
    shortcuts: await db.shortcuts.toArray(),
    settings: await readSettings(db),
    assets: await db.assets.toArray(),
  }));
  const byOrder = <T extends { readonly order: number }>(items: readonly T[]) => [...items].sort((left, right) => left.order - right.order);
  return { formatVersion: BACKUP_VERSION, exportedAt: new Date().toISOString(),
    folders: byOrder(state.folders),
    shortcuts: [...state.shortcuts].sort((a, b) => (a.folderId ?? '').localeCompare(b.folderId ?? '') || a.order - b.order),
    settings: state.settings, assets: state.assets };
}

export interface RestoreBackupInput {
  readonly document: BackupDocument;
  readonly assets: readonly MediaAsset[];
}

function matchesBackupAsset(source: BackupDocument['assets'][number] | undefined, asset: MediaAsset): boolean {
  if (!source) return false;
  const motion = asset.motion ? { kind: asset.motion.kind, duration: asset.motion.duration } : null;
  return source.kind === asset.kind && source.mime === asset.mime && source.width === asset.width
    && source.height === asset.height && source.sourceUrl === asset.sourceUrl && source.name === asset.name
    && JSON.stringify(source.motion) === JSON.stringify(motion) && source.byteLength === asset.blob.size;
}

function validateRestoreAssets(document: BackupDocument, assets: readonly MediaAsset[]): void {
  if (document.assets.length !== assets.length) fail('备份媒体记录不完整');
  const byId = new Map(document.assets.map((asset) => [asset.id, asset]));
  for (const asset of assets) if (!matchesBackupAsset(byId.get(asset.id), asset)) fail('媒体内容与备份记录不一致');
}

async function writeReplacement(db: Database, backup: RestoreBackupInput): Promise<void> {
  const { document } = backup;
  await db.transaction('rw', [db.folders, db.shortcuts, db.settings, db.assets, db.sync_state, db.sync_records], async () => {
    const replacement = await prepareSyncReplacement(db, backup, { createId: newId });
    parseBackup(replacement.document);
    await tombstoneReplacedShortcuts(db);
    await db.folders.clear();
    await db.shortcuts.clear();
    await db.settings.clear();
    await db.assets.clear();
    if (replacement.document.folders.length > 0) await db.folders.bulkAdd([...replacement.document.folders]);
    if (replacement.document.shortcuts.length > 0) await db.shortcuts.bulkAdd([...replacement.document.shortcuts]);
    await db.settings.put({ id: SETTINGS_ID, ...replacement.document.settings });
    if (replacement.assets.length > 0) await db.assets.bulkAdd([...replacement.assets]);
  });
}

export async function replaceAllData(db: Database, backup: RestoreBackupInput): Promise<void> {
  parseBackup(backup.document);
  validateRestoreAssets(backup.document, backup.assets);
  await writeReplacement(db, backup);
}

export async function resetLocalData(db: Database): Promise<void> {
  const settings = createDefaultSettings();
  await db.transaction('rw', [db.folders, db.shortcuts, db.settings, db.assets, db.sync_state, db.sync_records], async () => {
    await tombstoneReplacedShortcuts(db);
    await db.folders.clear();
    await db.shortcuts.clear();
    await db.assets.clear();
    await db.settings.put({ id: SETTINGS_ID, ...settings });
  });
}
